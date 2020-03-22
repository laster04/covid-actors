const Apify = require('apify');
const SOURCE_URL = 'https://www.terviseamet.ee/en/covid19';
const LATEST = 'LATEST';
const { log } = Apify.utils;

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-ESTONIA');
    const dataset = await Apify.openDataset("COVID-19-ESTONIA-HISTORY");
    await requestQueue.addRequest({ url: SOURCE_URL });

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({ $, body }) => {
            const now = new Date();
            const infectedByRegion = [];
            const h2s = $('h2').toArray();
            let totalInfected = undefined;
            for (let head of h2s) {
                head = $(head);
                if (head.text().trim() === 'CURRENT SITUATION'){
                    const parent = head.parent('div');
                    const list = parent.find('ul > li');
                    const total = list.eq(1).text().trim().match(/\s\d+\s/);
                    if (total) {
                        totalInfected = total[0];
                    }
                    // const regions = list.eq(2).text().trim();
                    // const splitRegions = regions.split(',');
                    // const splitLastRegions = splitRegions[splitRegions.length - 1].split('and');
                    // splitRegions.pop();
                    // splitRegions.push(splitLastRegions[0], splitLastRegions[1]);
                    // for (let i = 1; i < splitRegions.length; i++) {
                    //     let region = splitRegions[i]
                    //       .replace('in', '');
                    //     if (i === 1) {
                    //         region = region.replace('are', '');
                    //     }
                    //     const final = region.match(/(\d+)(\W+)([A-Za-z\säõ]+)/);
                    //     if (final) {
                    //         const [a, infectedCount, b, regionName] = final;
                    //         infectedByRegion.push({
                    //             region: regionName,
                    //             infectedCount: parseInt(infectedCount, 10),
                    //             deceasedCount: 0
                    //         });
                    //     }
                    // }
                }
            }

            const data = {
                infected: parseInt(totalInfected, 10),
                deceased: 0,
                SOURCE_URL,
                lastUpdatedAtApify: new Date(new Date().toUTCString()).toISOString(),
                readMe: 'https://apify.com/lukass/covid-est',
            };

            // Compare and save to history
            const latest = await kvStore.getValue(LATEST);
            if (latest){
                delete latest.lastUpdatedAtApify;
            }
            const actual = Object.assign({}, data);
            delete actual.lastUpdatedAtApify;
            await Apify.pushData(actual);

            if(JSON.stringify(latest)!== JSON.stringify(actual)){
                log.info('Data did change :( storing new to dataset.');
                await Apify.pushData(data);
            }

            await kvStore.setValue(LATEST, data);
            log.info('Data stored, finished.')
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed twice.`);
        },
    });

    log.info('CRAWLER -- start');
    await crawler.run();
    log.info('CRAWLER -- finish');
});
