const Apify = require('apify');
const SOURCE_URL = 'https://services8.arcgis.com/JdxivnCyd1rvJTrY/arcgis/rest/services/covid19_list_csv_EnglishView/FeatureServer/0/query?f=json&where=%E7%A2%BA%E5%AE%9A%E6%97%A5%20IS%20NOT%20NULL&returnGeometry=false&spatialRel=esriSpatialRelIntersects&outFields=*&orderByFields=%E7%A2%BA%E5%AE%9A%E6%97%A5%20asc&resultOffset=0&resultRecordCount=2000&cacheHint=true';
const LATEST = 'LATEST';
const {log, requestAsBrowser} = Apify.utils;


Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-JAPAN');
    const dataset = await Apify.openDataset("COVID-19-JAPAN-HISTORY");
    await requestQueue.addRequest({url: SOURCE_URL});

    const crawler = new Apify.BasicCrawler({
        requestQueue,
        handleRequestFunction: async ({request}) => {
            console.log('CRAWLER -- start with page')
            const response = await requestAsBrowser({
                url: request.url,
                json:true,
            });
            const body = response.body;
            const prefectureMap = new Map();
            for (const feature of body.features) {
                prefectureMap.set(feature.attributes.Prefectures, feature.attributes['都道府県別事例数']);
            }
            const infectedByRegion = [];
            let totalInfected = 0;
            for (let [key, value] of prefectureMap) {
                console.log(key + ' = ' + value);
                totalInfected += value;
                infectedByRegion.push({
                    region: key,
                    infectedCount: value,
                    deceasedCount: NaN
                });
            }

            const data = {
                infected: totalInfected,
                deceased: NaN,
                infectedByRegion,
                SOURCE_URL: 'https://mhlw-gis.maps.arcgis.com/apps/opsdashboard/index.html#/0c5d0502bbb54f9a8dddebca003631b8',
                lastUpdatedAtApify: new Date(new Date().toUTCString()).toISOString(),
                readMe: 'https://apify.com/lukass/covid-jap',
            };

            // Compare and save to history
            const latest = await kvStore.getValue(LATEST);
            if (latest) {
                delete latest.lastUpdatedAtApify;
            }
            const actual = Object.assign({}, data);
            delete actual.lastUpdatedAtApify;
            await Apify.pushData(data);

            if (JSON.stringify(latest) !== JSON.stringify(actual)) {
                log.info('Data did change :( storing new to dataset.');
                await dataset.pushData(data);
            }

            await kvStore.setValue(LATEST, data);
            log.info('Data stored, finished.')
        }
    });

    log.info('CRAWLER -- start');
    await crawler.run();
    log.info('CRAWLER -- finish');
});
