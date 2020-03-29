const Apify = require('apify');
const SOURCE_URL = 'https://www.terviseamet.ee/en/covid19';
const LATEST = 'LATEST';
const { log } = Apify.utils;

const LABELS = {
    GOV: 'GOV',
    WIKI: 'WIKI',
};

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-ESTONIA');
    const dataset = await Apify.openDataset("COVID-19-ESTONIA-HISTORY");
    await requestQueue.addRequest({ url: SOURCE_URL, userData: { label: LABELS.GOV} });

    await Apify.addWebhook({
        eventTypes: ['ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
        requestUrl: `https://api.apify.com/v2/acts/mnmkng~email-notification-webhook/runs?token=${Apify.getEnv().token}`,
        payloadTemplate: `{"notificationEmail": "sirhallukas@gmail.com", "eventType": {{eventType}}, "eventData": {{eventData}}, "resource": {{resource}} }`,
    });

    let totalInfected = 0;
    let totalDeceased = undefined;

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({ $, request }) => {
            const { label } = request.userData;
            const now = new Date();
            const infectedByRegion = [];
            switch (label) {
                case LABELS.GOV:
                    const h2s = $('h2').toArray();
                    for (let head of h2s) {
                        head = $(head);
                        if (head.text().trim() === 'CURRENT SITUATION'){
                            const parent = head.parent('div');
                            const list = parent.find('ul > li');
                            const total = list.eq(1).text().trim().match(/\s\d+\s/g);
                            if (total) {
                                totalInfected = total[1];
                            }
                        }
                    }
                    await requestQueue.addRequest({ url: 'https://en.wikipedia.org/wiki/2020_coronavirus_pandemic_in_Estonia', userData: { label: LABELS.WIKI }});
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
                    break;
            }
        },
        handleFailedRequestFunction: async ({ request }) => {
            console.log(`Request ${request.url} failed twice.`);
        },
    });

    log.info('CRAWLER -- start');
    await crawler.run();
    log.info('CRAWLER -- finish');
});
