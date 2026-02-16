import { createClient, type RedisClientType } from 'redis';
import * as h3 from 'h3-js'; // You need this to convert Split Point H3 to Lat/Lng
import { randomUUID } from 'crypto';
import { pubSubService } from './pubsub';

interface RouteMatch {
    match_type: 'DIRECT' | 'BEST_DETOUR' | 'NONE' | 'NEIGHBOUR';
    user_id?: string;
    detour_distance_meters?: number;
    split_point_h3?: string;
}

interface PassengerMetaData {
    no_of_passengers: number,
    destination_h3: string,
    luggage: number,
    status: 'WAITING' | 'ACTIVE',
    issued_price: number
}

interface LatLng {
    lat: number;
    lng: number;
}

interface TripMetaData {
    users: {},
    no_of_passengers: number,
    luggage: number,
    status: 'WAITING' | 'ACTIVE',
    issued_price: number
}

interface GoogleRoutesResponse {
    routes?: Array<{
        distanceMeters: number;
        // add other fields if you need them later (duration, polyline, etc.)
    }>;
}

export class RedisPoolingService {
    private LUGGAGE_CAPACITY: number = 4
    private MAX_PASSENGERS: number = 3
    private client: RedisClientType;
    private readonly POOL_KEY = 'h3:airport_pool';
    private readonly GOOGLE_API_KEY = process.env.GOOGLE_ROUTES_API_KEY; // Replace with actual key

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

    async storePassengerMetaData(user_id: string, metadata: PassengerMetaData): Promise<boolean> {
        try {
            await this.client.set(user_id, JSON.stringify(metadata))
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

    async matchUserWithAvaialbleTrip(user_id: string, routeIndexes: string[], userMetaData: PassengerMetaData): Promise<RouteMatch> {
        try {

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
                const isTripEligible: boolean | TripMetaData = await this.checkMatchConstraints(matchedUser, userMetaData, user_id, myRouteString, perfectLongMatch)

                if (typeof isTripEligible !== 'boolean') {
                    return {
                        match_type: 'DIRECT',
                        user_id: matchedUser
                    }
                }
                console.log("STEP 1: Found direct match (Longer route containing us) ->", matchedUser);
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

            const allNeighbors = [...predecessors, ...successors].filter(c => {
                return !c.includes(user_id) && !c.includes('TRIP')
            });

            // --- STEP 1 Check B: Am I a SUPERSET? ---
            for (const neighbor of allNeighbors) {
                const [neighborRoute, neighborId] = neighbor.split('::');
                if (myRouteString.startsWith(neighborRoute)) {
                    console.log("STEP 1: Found direct match (Shorter route inside us) ->", neighborId);

                    const isTripEligible: boolean | TripMetaData = await this.checkMatchConstraints(neighborId, userMetaData, user_id, myRouteString, neighbor)

                    if (typeof isTripEligible !== 'boolean') {
                        return {
                            match_type: 'DIRECT',
                            user_id: neighborId
                        }
                    }
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
                    if (myRouteString.substring(i, i + 15) !== candidateRouteString.substring(i, i + 15)) {
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

                    const isTripEligible: boolean | TripMetaData = await this.checkMatchConstraints(candidateUserId, userMetaData, user_id, myRouteString, candidate)

                    if (typeof isTripEligible !== 'boolean') {
                        return bestMatch = {
                            match_type: 'BEST_DETOUR',
                            user_id: candidateUserId,
                            detour_distance_meters: detourMeters,
                            split_point_h3: splitPointH3
                        };
                    }
                }
            }

            return bestMatch;

        } catch (e) {
            console.log(e);
            return { match_type: 'NONE' };
        }
    }

    private async checkMatchConstraints(matchedUserId: string, requestingUserMetaData: PassengerMetaData, requestingUserId: string, requestingUserRouteSignature: string, matchedUserSignature: string): Promise<boolean | TripMetaData> {
        try {

            const matchedUserData: string | {} | null = await this.client.get(matchedUserId)
            if (typeof matchedUserData === 'string' && matchedUserData) {

                const data: PassengerMetaData = JSON.parse(matchedUserData)
                if (data.luggage + requestingUserMetaData.luggage > this.LUGGAGE_CAPACITY || data.no_of_passengers + requestingUserMetaData.no_of_passengers > this.MAX_PASSENGERS) {
                    return false
                }
                const status = data.luggage + requestingUserMetaData.luggage === this.LUGGAGE_CAPACITY || data.no_of_passengers + requestingUserMetaData.no_of_passengers === this.MAX_PASSENGERS

                // Remove both route signatures from the pool sorted set
                await this.client.zRem(this.POOL_KEY, [requestingUserRouteSignature, matchedUserSignature])

                // Delete metadata sets for both users
                await this.client.del([matchedUserId, requestingUserId])

                const tripKey = `TRIP${randomUUID()}`

                // Store the combined trip route back in Redis
                if (!status) {
                    await this.storeTripRoute(requestingUserRouteSignature, matchedUserSignature, tripKey)
                }

                const tripMetaData: TripMetaData = {
                    users: [data, requestingUserMetaData],
                    luggage: data.luggage + requestingUserMetaData.luggage,
                    no_of_passengers: data.no_of_passengers + requestingUserMetaData.no_of_passengers,
                    status: status ? 'ACTIVE' : 'WAITING',
                    issued_price: data.issued_price * 0.3 //TODO: Calculate the new price for the trip here
                }

                // Store the trip metadata in Redis under the same trip key
                await this.storeTripMetaData(tripKey, tripMetaData)

                // Notify the matched user via Redis PubSub (WebSocket will receive this)
                await pubSubService.publish(matchedUserId, {
                    type: 'RIDE_MATCHED',
                    tripKey,
                    tripMetaData
                }).catch((err) => console.error('PubSub publish error:', err));

                return tripMetaData
            }
            return false

        } catch (e) {
            console.log(e)
            return false
        }
    }

    private async storeTripRoute(requestingUserRouteSignature: string, matchedUserSignature: string, tripKey: string): Promise<void> {
        try {
            const requestingUserRoute = requestingUserRouteSignature.split('::')[0]
            const matchedUserRoute = matchedUserSignature.split('::')[0]
            let tripRoute = ""
            if (requestingUserRoute.length >= matchedUserRoute.length) {
                tripRoute = requestingUserRoute + "::" + tripKey
            }
            tripRoute = matchedUserRoute + "::" + tripKey

            await this.client.zAdd(this.POOL_KEY, [{ score: 0, value: tripRoute }]);

            console.log(`Stored trip route under key: ${tripKey}`)
        } catch (e) {
            console.log('Error storing trip route:', e)
        }
    }

    private async storeTripMetaData(tripKey: string, tripMetaData: TripMetaData): Promise<void> {
        try {
            await this.client.set(tripKey, JSON.stringify(tripMetaData))
            console.log(`Stored trip metadata under key: ${tripKey}`)
        } catch (e) {
            console.log('Error storing trip metadata:', e)
        }
    }
}