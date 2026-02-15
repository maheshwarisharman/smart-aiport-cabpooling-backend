import { RedisPoolingService } from './src/utils/redisCaching'
import {generateH3IndexesForRoute} from './src/rideMatching/demo'
import {dataSet} from './src/utils/sampleDataSet'
import express from 'express'

const app = express()

const userDestination = {
    "latitude": 28.642447,
    "longitude": 77.228559,
    "name": "JawarLalMarg"
}

const redisService = new RedisPoolingService()

async function main() {
    await redisService.connect()

    // for(const item of dataSet) {
        const result = await generateH3IndexesForRoute(userDestination)
        const res1 = await redisService.storeDestinationH3Index(userDestination.name, result.destinationH3)
        //Get the h3 index of the destination
        if(res1) {
            console.log("Destination Index stored Success");
        }
        const res2 = await redisService.storeRouteH3Index(userDestination.name, result.pathH3Indexes)
        if(res2) {
            console.log("Route Indexes stored successfully");
        }
    // }

}
main()

app.get('/', async (req, res) => {
    const result = await generateH3IndexesForRoute(userDestination)

    const matches = await redisService.matchUserWithAvaialbleTrip(userDestination.name, result.pathH3Indexes, result.destinationH3)
    console.log(matches)
    res.json(matches)
})

app.listen(3000)

