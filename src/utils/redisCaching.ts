import { createClient, type RedisClientType } from 'redis';
import * as h3 from 'h3-js'; // You need this to convert Split Point H3 to Lat/Lng

interface RouteMatch {
    match_type: 'DIRECT' | 'BEST_DETOUR' | 'NONE' | 'NEIGHBOUR';
    user_id?: string;
    detour_distance_meters?: number;
    split_point_h3?: string;
}

interface LatLng {
    lat: number;
    lng: number;
}

interface GoogleRoutesResponse {
    routes?: Array<{
        distanceMeters: number;
        // add other fields if you need them later (duration, polyline, etc.)
    }>;
}

export class RedisPoolingService {
    private client: RedisClientType;
    private readonly POOL_KEY = 'h3:airport_pool';
    private readonly GOOGLE_API_KEY = ''; // Replace with actual key

    constructor() {
        this.client = createClient({
            url: 'redis://localhost:6379'
        });
        this.client.on('error', (err) => console.error('Redis Client Error', err));
    }

    async connect(): Promise<void> {
        await this.client.connect();
        console.log('Connected to Redis');
    }

    async disconnect(): Promise<void> {
        await this.client.quit();
        console.log('Disconnected from Redis');
    }

    private getRouteString(routeIndexes: string[]): string {
        return routeIndexes.join('');
    }

    // --- GOOGLE ROUTES API HELPER ---
    private async fetchRouteDistance(origin: LatLng, destination: LatLng): Promise<number> {
        const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Goog-Api-Key': this.GOOGLE_API_KEY,
                    'X-Goog-FieldMask': 'routes.distanceMeters' // We only need distance
                },
                body: JSON.stringify({
                    origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
                    destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
                    travelMode: 'DRIVE'
                })
            });

            if (!response.ok) throw new Error(`Google API Error: ${response.status}`);
            
            const data = await response.json() as GoogleRoutesResponse;
            if (!data.routes || data.routes.length === 0) throw new Error('No route found');

            return data.routes[0].distanceMeters;

        } catch (error) {
            console.error('Google Routes API error:', error);
            return 9999999; // Return huge distance on error so this candidate is ignored
        }
    }

    async storeDestinationH3Index(user_id: string, destinationH3: string): Promise<boolean> {
        const key = `h3:destination:${destinationH3}`
        
        try {

            await this.client.set(key, user_id)
            await this.client.expire(key, 86400)
            return true

        } catch (e) {
            console.log(e)
            return false
        }
    }

    async storeRouteH3Index(user_id: string, routeIndexes: string[]): Promise<boolean> {
        try {
            const routeString = this.getRouteString(routeIndexes);
            const memberValue = `${routeString}::${user_id}`;
            await this.client.zAdd(this.POOL_KEY, [{ score: 0, value: memberValue }]);
            console.log(`Stored route for ${user_id}`);
            return true;
        } catch (e) {
            console.log("Error in redis storage ", e);
            return false;
        }
    }

    async matchUserWithAvaialbleTrip(user_id: string, routeIndexes: string[], DestinationH3Index: string): Promise<RouteMatch> {
        try {

            const directDestMatch: string | {} | null = await this.client.get(`h3:destination:${DestinationH3Index}`)
            if(typeof directDestMatch === 'string' && directDestMatch && directDestMatch !== user_id) {
                console.log("Found direct match with user in same area: ", directDestMatch)
                return {
                    match_type: 'NEIGHBOUR',
                    user_id: directDestMatch
                }
            }

            const myRouteString = this.getRouteString(routeIndexes);
            const myDestinationH3 = routeIndexes[routeIndexes.length - 1];

            // --- STEP 1 Check A: Am I a SUBSET? ---
            const supersetCandidates = await this.client.zRange(
                this.POOL_KEY, `[${myRouteString}`, `[${myRouteString}\xff`, 
                { BY: 'LEX', LIMIT: { offset: 0, count: 5 } }
            );

            const perfectLongMatch = supersetCandidates.find(c => !c.includes(user_id));
            if (perfectLongMatch) {
                const matchedUser = perfectLongMatch.split('::')[1];
                console.log("STEP 1: Found direct match (Longer route containing us) ->", matchedUser);
                return { match_type: 'DIRECT', user_id: matchedUser };
            }

            // --- STEP 2: Fetch Neighbors ---
            const predecessors = await this.client.zRange(
                this.POOL_KEY, `[${myRouteString}`, '-', 
                { BY: 'LEX', REV: true, LIMIT: { offset: 0, count: 5 } } // Reduced count for performance
            );
            const successors = await this.client.zRange(
                this.POOL_KEY, `[${myRouteString}`, '+', 
                { BY: 'LEX', LIMIT: { offset: 0, count: 5 } }
            );

            const allNeighbors = [...predecessors, ...successors].filter(c => !c.includes(user_id));

            // --- STEP 1 Check B: Am I a SUPERSET? ---
            for (const neighbor of allNeighbors) {
                const [neighborRoute, neighborId] = neighbor.split('::');
                if (myRouteString.startsWith(neighborRoute)) {
                    console.log("STEP 1: Found direct match (Shorter route inside us) ->", neighborId);
                    return { match_type: 'DIRECT', user_id: neighborId };
                }
            }

            // --- STEP 2 (REAL): Calculate Detour for Candidates ---
            console.log(`STEP 2: Analyzing ${allNeighbors.length} neighbors for best detour...`);
            
            let bestMatch: RouteMatch = { match_type: 'NONE' };
            let minDetourMeters = Infinity;

            // We iterate through neighbors to find the "Split Point" and calculate distance
            for (const candidate of allNeighbors) {
                const [candidateRouteString, candidateUserId] = candidate.split('::');

                // 1. Find Longest Common Prefix (Split Point)
                // Since H3 indexes are fixed length (15 chars), we step by 15
                let splitIndex = 0;
                const minLen = Math.min(myRouteString.length, candidateRouteString.length);
                
                // Jump 15 chars at a time to find which H3 index diverges
                for (let i = 0; i < minLen; i += 15) {
                    if (myRouteString.substring(i, i+15) !== candidateRouteString.substring(i, i+15)) {
                        break; 
                    }
                    splitIndex = i + 15; // They match up to here
                }

                // If splitIndex is 0, they diverge immediately (at airport exit). Ignore.
                if (splitIndex === 0) continue;

                // 2. Extract the H3 Index at the split point
                // (splitIndex is the END of the matching string, so look back 15 chars)
                const splitPointH3 = myRouteString.substring(splitIndex - 15, splitIndex);
                
                // 3. Extract Candidate's Destination H3 (Last 15 chars of their string)
                const candidateDestH3 = candidateRouteString.slice(-15);

                // 4. Convert H3 to Lat/Lng
                const splitLatLng = h3.cellToLatLng(splitPointH3); // Returns [lat, lng]
                const candidateDestLatLng = h3.cellToLatLng(candidateDestH3);

                const splitObj = { lat: splitLatLng[0], lng: splitLatLng[1] };
                const destObj = { lat: candidateDestLatLng[0], lng: candidateDestLatLng[1] };

                // 5. Calculate Driving Distance from Split -> Candidate Dest
                // (This represents the "arm" of the Y-split that is unique to them)
                const detourMeters = await this.fetchRouteDistance(splitObj, destObj);
                
                console.log(`Candidate ${candidateUserId}: Splits at ${splitPointH3}, Detour: ${detourMeters}m`);

                // 6. Check Threshold (e.g., Detour must be < 3km)
                // You can add logic here: e.g. "If detour > 3000m, ignore"
                if (detourMeters < 3000 && detourMeters < minDetourMeters) {
                    minDetourMeters = detourMeters;
                    bestMatch = {
                        match_type: 'BEST_DETOUR',
                        user_id: candidateUserId,
                        detour_distance_meters: detourMeters,
                        split_point_h3: splitPointH3
                    };
                }
            }

            return bestMatch;

        } catch(e) {
            console.log(e);
            return { match_type: 'NONE' };
        }
    }
}