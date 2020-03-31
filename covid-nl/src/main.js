const Apify = require('apify');
const cheerio = require('cheerio');
const SOURCE_URL = 'https://www.rivm.nl/actuele-informatie-over-coronavirus';
const LATEST = 'LATEST';
const {log, requestAsBrowser} = Apify.utils;

const LABELS = {
    GOV: 'GOV',
    WIKI: 'WIKI',
};

Apify.main(async () => {
    const requestQueue = await Apify.openRequestQueue();
    const kvStore = await Apify.openKeyValueStore('COVID-19-NL');
    const dataset = await Apify.openDataset("COVID-19-NL-HISTORY");
    await requestQueue.addRequest({ url: SOURCE_URL, userData: { label: LABELS.GOV }});

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
        maxRequestRetries: 2,
        apifyProxyGroups: ['GERMANY'],
        handlePageTimeoutSecs: 120,
        handlePageFunction: async ({$, request}) => {
            const { label } = request.userData;
            switch (label) {
                case LABELS.GOV:
                    const contentDivs = $('.sdv-landingspagina .card-deck');
                    if (contentDivs.length > 0) {
                        const cards = contentDivs.find('.card-body');
                        const bodyInfected = cards.eq(0).find('p').eq(0).text().trim();
                        const infectedMatch = bodyInfected.match(/(\d+[\s,\.]\d+)/);
                        const bodyDeceased = cards.eq(2).find('p').eq(0).text().trim();
                        const deceasedMatch = bodyDeceased.match(/(\d+[\s,\.]\d+)/);
                        totalInfected = infectedMatch[0].replace('.', '');
                        totalDeceased = deceasedMatch[0].replace('.', '');
                    }
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

    const data = {
        infected: parseInt(totalInfected, 10),
        tested: undefined,
        deceased: parseInt(totalDeceased, 10),
        country: 'Netherlands',
        moreData: 'https://api.apify.com/v2/key-value-stores/vqnEUe7VtKNMqGqFF/records/LATEST?disableRedirect=true',
        historyData: 'https://api.apify.com/v2/datasets/jr5ogVGnyfMZJwpnB/items?format=json&clean=1',
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

    if (latest.infected > actual.infected || latest.deceased > actual.deceased) {
        log.error('Actual numbers are lower then latest probably wrong parsing');
        process.exit(1);
    }

    await kvStore.setValue(LATEST, data);
    log.info('Data stored, finished.');
});
