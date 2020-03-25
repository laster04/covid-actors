const Apify = require('apify');
const SOURCE_URL = 'https://www.korona.gov.sk';
const LATEST = 'LATEST';
const {log} = Apify.utils;

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-SK');
    const dataset = await Apify.openDataset("COVID-19-SK-HISTORY");
    await requestQueue.addRequest({url: SOURCE_URL});

    await Apify.addWebhook({
        eventTypes: ['ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
        requestUrl: `https://api.apify.com/v2/acts/mnmkng~email-notification-webhook/runs?token=${Apify.getEnv().token}`,
        payloadTemplate: `{"notificationEmail": "sirhallukas@gmail.com", "eventType": {{eventType}}, "eventData": {{eventData}}, "resource": {{resource}} }`,
    });

    const crawler = new Apify.CheerioCrawler({
        requestQueue,
        useApifyProxy: true,
        apifyProxyGroups: ['CZECH_LUMINATI'],
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({$, body}) => {
            let totalInfected = 0;
            let tested = 0;
            let negative = 0;
            let totalDeceased = undefined;
            const contentDivs = $('.covd-counter > div');
            if (contentDivs) {
                tested = contentDivs.eq(0).find('.countValue').text().trim();
                negative = contentDivs.eq(1).find('.countValue').text().trim();
                const total = contentDivs.eq(2).find('.countValue').text().trim();
                if (total) {
                    totalInfected = total;
                }
            }

            const data = {
                tested: parseInt(tested, 10),
                negative: parseInt(negative, 10),
                infected: parseInt(totalInfected, 10),
                deceased: parseInt(totalDeceased, 10),
                SOURCE_URL,
                lastUpdatedAtApify: new Date(new Date().toUTCString()).toISOString(),
                readMe: 'https://apify.com/lukass/covid-sk',
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
