const Apify = require('apify');
const cheerio = require('cheerio');
const SOURCE_URL = 'https://www.rivm.nl/node/152921';
const LATEST = 'LATEST';
const {log, requestAsBrowser} = Apify.utils;

const LABELS = {
    GOV: 'GOV',
    WIKI: 'WIKI',
};

let totalInfected = 0;
let totalDeceased = undefined;

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-NL');
    const dataset = await Apify.openDataset("COVID-19-NL-HISTORY");
    await requestQueue.addRequest({ url: SOURCE_URL, userData: { label: LABELS.GOV }});

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        apifyProxyGroups: ['GERMANY'],
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({$, request}) => {
            const { label } = request.userData;
            switch (label) {
                case LABELS.GOV:
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
                    await requestQueue.addRequest({ url: 'https://en.wikipedia.org/wiki/2020_coronavirus_pandemic_in_the_Netherlands', userData: { label: LABELS.WIKI }});
                    break;
                case LABELS.WIKI:
                    const tableRows = $('table.infobox tr').toArray();
                    for (const row of tableRows) {
                        const $row = $(row);
                        const th = $row.find('th');
                        if (th) {
                            const value = $row.find('td');
                            if (th.text().trim() === 'Deaths') {
                                totalDeceased = value.text().trim();
                            }
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
                    break;
            }

        },
        handleFailedRequestFunction: async ({request}) => {
            console.log(`Request ${request.url} failed twice.`);
        },
    });

    log.info('CRAWLER -- start');
    await crawler.run();
    log.info('CRAWLER -- finish');
});
