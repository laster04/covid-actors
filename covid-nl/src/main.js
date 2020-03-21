const Apify = require('apify');
const SOURCE_URL = 'https://www.rivm.nl/node/152921';
const LATEST = 'LATEST';
const {log} = Apify.utils;

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-NL');
    const dataset = await Apify.openDataset("COVID-19-NL-HISTORY");
    await requestQueue.addRequest({url: SOURCE_URL});

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        apifyProxyGroups: ['GERMANY'],
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({$, body}) => {
            let totalInfected = 0;
            let totalDeceased = undefined;
            const contentDivs = $('.content').toArray();
            for (const cd of contentDivs) {
                const contentTitle = $(cd).find('h2');
                if (contentTitle) {
                    const text = contentTitle.text().trim();
                    if (text.includes('Current news')) {
                        totalInfected = $(cd).find('h4').text().trim();
                    }
                }
            }
            const newsTitle = $('h2').toArray();
            for (const title of newsTitle) {
                const text = $(title).text().trim();
                if (text.includes('deceased')) {
                    const arr = text.split(',');
                    for (const a of arr) {
                        if (a.includes('deceased')) {
                            const match = a.match(/\d+/);
                            if (match) {
                                totalDeceased = match[0];
                            }
                        }
                    }
                    break;
                }
            }

            const data = {
                infected: parseInt(totalInfected, 10),
                deceased: parseInt(totalDeceased, 10),
                SOURCE_URL,
                lastUpdatedAtApify: new Date(new Date().toUTCString()).toISOString(),
                readMe: 'https://apify.com/lukass/covid-nl',
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
        },
        handleFailedRequestFunction: async ({request}) => {
            console.log(`Request ${request.url} failed twice.`);
        },
    });

    log.info('CRAWLER -- start');
    await crawler.run();
    log.info('CRAWLER -- finish');
});
