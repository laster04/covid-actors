const Apify = require('apify');
const SOURCE_URL = 'https://www.korona.gov.sk';
const LATEST = 'LATEST';
const { log, requestAsBrowser } = Apify.utils;

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-SK');
    const dataset = await Apify.openDataset("COVID-19-SK-HISTORY");
    await requestQueue.addRequest({url: 'https://mojeezdravie.nczisk.sk/api/v1/ezdravie-stats-proxy-api.php'});

    await Apify.addWebhook({
        eventTypes: ['ACTOR.RUN.FAILED', 'ACTOR.RUN.TIMED_OUT'],
        requestUrl: `https://api.apify.com/v2/acts/mnmkng~email-notification-webhook/runs?token=${Apify.getEnv().token}`,
        payloadTemplate: `{"notificationEmail": "sirhallukas@gmail.com", "eventType": {{eventType}}, "eventData": {{eventData}}, "resource": {{resource}} }`,
    });

    const crawler = new Apify.BasicCrawler({
        requestQueue,
        handleRequestFunction: async ({ request }) => {
            const proxyUrl = Apify.getApifyProxyUrl({
                groups: ['CZECH_LUMINATI'],
            });

            const response = await requestAsBrowser({
                url: request.url,
                proxyUrl,
                json:true,
            });
            const body = response.body.tiles;

            const k26 = body.k26.data;
            const k25 = body.k25.data;
            let totalInfected = 0;
            let negative = 0;
            let totalDeceased = undefined;

            if (k25.d[k25.d.length - 1].v) {
                negative = k25.d[k25.d.length - 1].v;
            }
            if (k26.d[k26.d.length - 1].v) {
                totalInfected = k26.d[k26.d.length - 1].v
            }
            if (totalInfected === 0 || negative === 0) {
                throw new Error('BAD scraping non results')
            }

            const data = {
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
