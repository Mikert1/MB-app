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
        body.appendChild(settingRow(
            'Hours in your week',
            'Now ' + U.minutesToHours(Store.settings().weekHours * 60) + ' hours — what the bar on My week measures against',
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
