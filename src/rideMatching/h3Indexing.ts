import { latLngToCell, gridPathCells } from 'h3-js';

/**
 * Configuration
 */
const AIRPORT_LOCATION = {
  lat: 28.5562, // Example: Delhi Airport
  lng: 77.1000
};

const H3_RESOLUTION = 8; // ~0.7km hexagon width (good for urban areas)

/**
 * Fetch route from Google Routes API
 */
async function fetchRouteFromGoogle(origin, destination, apiKey) {
  const url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.legs.steps.startLocation,routes.legs.steps.endLocation'
      },
      body: JSON.stringify({
        origin: {
          location: {
            latLng: {
              latitude: origin.lat,
              longitude: origin.lng
            }
          }
        },
        destination: {
          location: {
            latLng: {
              latitude: destination.lat,
              longitude: destination.lng
            }
          }
        },
        travelMode: 'DRIVE'
      })
    });
    
    if (!response.ok) {
      throw new Error(`Google Routes API error: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (!data.routes || data.routes.length === 0) {
      throw new Error('No route found');
    }
    
    // Extract all points from the route
    const routePoints = [];
    
    data.routes[0].legs.forEach(leg => {
      leg.steps.forEach(step => {
        // Add start location
        if (step.startLocation && step.startLocation.latLng) {
          routePoints.push({
            lat: step.startLocation.latLng.latitude,
            lng: step.startLocation.latLng.longitude
          });
        }
        
        // Add end location
        if (step.endLocation && step.endLocation.latLng) {
          routePoints.push({
            lat: step.endLocation.latLng.latitude,
            lng: step.endLocation.latLng.longitude
          });
        }
      });
    });
    
    return { routePoints };
    
  } catch (error) {
    console.error('Google Routes API error:', error);
    throw error;
  }
}

/**
 * Fill gaps between route points using H3's gridPathCells
 */
function fillRouteGaps(h3Indexes) {
  if (h3Indexes.length < 2) {
    return h3Indexes;
  }
  
  const filledIndexes = new Set();
  filledIndexes.add(h3Indexes[0]);
  
  for (let i = 0; i < h3Indexes.length - 1; i++) {
    const start = h3Indexes[i];
    const end = h3Indexes[i + 1];
    
    try {
      const pathCells = gridPathCells(start, end);
      pathCells.forEach(cell => filledIndexes.add(cell));
    } catch (error) {
      console.warn(`Could not fill gap between ${start} and ${end}`);
      filledIndexes.add(end);
    }
  }
  
  return Array.from(filledIndexes);
}

/**
 * Generate H3 indexes for destination and entire route
 */
async function generateH3IndexesForRoute(destination, googleApiKey, options = {}) {
  const {
    origin = AIRPORT_LOCATION,
    resolution = H3_RESOLUTION,
    fillGaps = true
  } = options;
  
  try {
    // Step 1: Get the H3 index for the destination
    const destinationH3 = latLngToCell(destination.lat, destination.lng, resolution);
    
    // Step 2: Fetch the route from Google Routes API
    const routeData = await fetchRouteFromGoogle(origin, destination, googleApiKey);
    
    // Step 3: Convert all route points to H3 indexes
    const routeH3Indexes = routeData.routePoints.map(point => 
      latLngToCell(point.lat, point.lng, resolution)
    );
    
    // Step 4: Remove duplicates
    let uniqueH3Indexes = [...new Set(routeH3Indexes)];
    
    // Step 5: Fill gaps between hexagons
    if (fillGaps) {
      uniqueH3Indexes = fillRouteGaps(uniqueH3Indexes);
    }
    
    // Step 6: Ensure destination hexagon is included
    if (!uniqueH3Indexes.includes(destinationH3)) {
      uniqueH3Indexes.push(destinationH3);
    }
    
    return {
      destinationH3,
      pathH3Indexes: uniqueH3Indexes,
      totalHexagons: uniqueH3Indexes.length
    };
    
  } catch (error) {
    console.error('Error generating H3 indexes:', error);
    throw error;
  }
}

/**
 * Example usage
 */
async function example() {
  const GOOGLE_API_KEY = 'YOUR_GOOGLE_API_KEY'; // Replace with your actual API key
  
  const userDestination = {
    lat: 28.6139, // Example: Connaught Place, Delhi
    lng: 77.2090
  };
  
  const result = await generateH3IndexesForRoute(userDestination, GOOGLE_API_KEY);
  
  console.log('Destination H3:', result.destinationH3);
  console.log('Total hexagons along route:', result.totalHexagons);
  console.log('Route H3 indexes:', result.pathH3Indexes);
  
  return result;
}

// Export for use in your application
export { generateH3IndexesForRoute };