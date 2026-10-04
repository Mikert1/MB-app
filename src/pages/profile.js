/**
 * Page 5 — profile: the few settings this demo has, and the way out.
 *
 * The export is the point of it. Everything lives in this browser, so the only
 * way a tester's real work survives into a backend later is if they can hand
 * it over as a file.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;

    let section, r;

    function settingRow(label, sub, onPick) {
        const row = U.clone('tpl-menuRow');
        const rr = U.roles(row);
        U.setText(rr.label, label);
        U.setText(rr.sub, sub || '');
        U.toggle(rr.sub, !!sub);
        row.addEventListener('click', onPick);
        return row;
    }

    /**
     * This week in hours, measured against the target below it. It used to sit
     * at the top of My week, where it was the first thing you saw every time;
     * it reads better here, next to the setting that defines it.
     */
    function capacityCard() {
        const card = U.clone('tpl-capacity');
        const cr = U.roles(card);
        const days = U.weekDays(U.mondayOf(new Date()));
        const load = Store.weekLoad(days);

        U.setText(cr.planned, (U.duration(load.total) || '0u') + (load.unknown ? '+' : ''));
        U.setText(cr.target, U.duration(load.target));
        U.setText(cr.jobCount, U.plural(load.count, 'job', 'jobs') +
            (load.unknown ? ' \u00b7 ' + load.unknown + ' untimed' : ''));
        U.setText(cr.freeLabel, load.over ? U.duration(load.over) + ' over' : U.duration(load.free) + ' free');
        U.setText(cr.capUnder, load.over ? 'planned \u2014 over your week' : 'planned this week');

        const scale = Math.max(load.target, load.total) || 1;
        const spill = Math.min(load.over, load.ahead);
        cr.barDone.style.width = (load.done / scale * 100) + '%';
        cr.barAhead.style.width = ((load.ahead - spill) / scale * 100) + '%';
        cr.barOver.style.width = (spill / scale * 100) + '%';

        return card;
    }

    function sectionLabel(text) {
        const el = U.clone('tpl-sectionLabel');
        const sr = U.roles(el);
        U.setText(sr.label, text);
        U.setText(sr.aside, '');
        return el;
    }

    function render() {
        const body = U.empty(r.profileBody);
        const jobs = Store.jobs();
        const done = Store.doneJobs().length;

        body.appendChild(U.clone('tpl-profileCard'));

        /* What they have put in so far — the numbers that make the export feel
           like it is worth sending. */
        const stats = U.clone('tpl-statRow');
        const sr = U.roles(stats);
        U.setText(sr.a, jobs.length);
        U.setText(sr.aLbl, jobs.length === 1 ? 'job' : 'jobs');
        U.setText(sr.b, done);
        U.setText(sr.bLbl, 'done');
        U.setText(sr.c, Store.clients().length);
        U.setText(sr.cLbl, Store.clients().length === 1 ? 'client' : 'clients');
        body.appendChild(stats);

        body.appendChild(sectionLabel('Your week'));
        body.appendChild(capacityCard());
        body.appendChild(settingRow(
            'Hours in your week',
            'Now ' + U.minutesToHours(Store.settings().weekHours * 60) + ' hours — what the bar above measures against',
            () => W.sheets.weekTarget(() => {
                render();
                W.pages.week.render();
            })
        ));

        body.appendChild(sectionLabel('Your data'));
        body.appendChild(settingRow(
            'Export everything',
            'One file with all your work in it, to send over',
            () => W.sheets.export()
        ));
        body.appendChild(settingRow(
            'Where this is stored',
            'On this device only — nothing leaves it',
            () => W.sheets.storageInfo()
        ));
    }

    W.pages = W.pages || {};
    W.pages.profile = {
        init: function (el) {
            section = el;
            r = U.roles(section);
        },
        show: render,
        render: render
    };

}(window));
