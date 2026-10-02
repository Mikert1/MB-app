/* Small helpers: DOM, dates, formatting. No app state lives here. */
(function (W) {
    'use strict';

    const U = W.util = {};

    /* ---------------- DOM ---------------- */

    U.$ = (sel, root) => (root || document).querySelector(sel);
    U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

    /**
     * Everything carrying a data-role in `root`, as { role: element }.
     * The root itself counts: querySelectorAll skips it, and a template whose
     * outermost element is the one with the role (tpl-menuSheet) would
     * otherwise come back missing.
     */
    U.roles = function (root) {
        const map = {};
        if (root && root.dataset && root.dataset.role) map[root.dataset.role] = root;
        U.$$('[data-role]', root).forEach(el => {
            if (!(el.dataset.role in map)) map[el.dataset.role] = el;
        });
        return map;
    };

    /** Clone a <template> by id and return its first element child. */
    U.clone = function (id) {
        const tpl = document.getElementById(id);
        if (!tpl) throw new Error('missing template: ' + id);
        return tpl.content.firstElementChild.cloneNode(true);
    };

    U.empty = function (el) {
        while (el.firstChild) el.removeChild(el.firstChild);
        return el;
    };

    /** Show/hide without touching layout classes. */
    U.toggle = function (el, on) {
        if (el) el.hidden = !on;
    };

    U.setText = function (el, text) {
        if (el) el.textContent = text == null ? '' : String(text);
    };

    /* ---------------- dates ----------------
       Dates are stored as plain 'YYYY-MM-DD' strings and parsed as
       local midnight, never as UTC — a job planned on the 3rd must
       stay on the 3rd whatever timezone the device is in. */

    const DAY_MS = 86400000;
    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    U.pad2 = n => (n < 10 ? '0' : '') + n;

    /** Date object -> 'YYYY-MM-DD' in local time. */
    U.iso = function (d) {
        return d.getFullYear() + '-' + U.pad2(d.getMonth() + 1) + '-' + U.pad2(d.getDate());
    };

    /** 'YYYY-MM-DD' -> Date at local midnight. */
    U.parseDate = function (iso) {
        const p = String(iso).split('-');
        return new Date(+p[0], +p[1] - 1, +p[2]);
    };

    U.startOfToday = function () {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    };

    U.today = () => U.iso(new Date());

    U.addDays = function (d, n) {
        const out = new Date(d.getTime());
        out.setDate(out.getDate() + n);
        out.setHours(0, 0, 0, 0);
        return out;
    };

    U.addDaysIso = (iso, n) => U.iso(U.addDays(U.parseDate(iso), n));

    /** Monday of the week `d` falls in. */
    U.mondayOf = function (d) {
        const out = new Date(d.getTime());
        out.setHours(0, 0, 0, 0);
        // getDay(): 0 = Sunday, so Sunday belongs to the week that started 6 days ago
        const shift = (out.getDay() + 6) % 7;
        out.setDate(out.getDate() - shift);
        return out;
    };

    /** ISO-8601 week number (weeks start Monday, week 1 holds the first Thursday). */
    U.weekNumber = function (d) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
        const firstThursday = new Date(t.getFullYear(), 0, 4);
        firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
        return 1 + Math.round((t - firstThursday) / (7 * DAY_MS));
    };

    U.daysBetween = function (isoA, isoB) {
        return Math.round((U.parseDate(isoB) - U.parseDate(isoA)) / DAY_MS);
    };

    U.dayName = iso => DAY_NAMES[U.parseDate(iso).getDay()];
    U.dayShort = iso => DAY_SHORT[U.parseDate(iso).getDay()];
    U.dayOfMonth = iso => U.parseDate(iso).getDate();

    /** '3 Oct' */
    U.shortDate = function (iso) {
        const d = U.parseDate(iso);
        return d.getDate() + ' ' + MONTH_SHORT[d.getMonth()];
    };

    /** 'Week 40 · 28 Sep – 4 Oct' */
    U.weekLabel = function (monday) {
        const sunday = U.addDays(monday, 6);
        return 'Week ' + U.weekNumber(monday) + ' · ' +
            U.shortDate(U.iso(monday)) + ' – ' + U.shortDate(U.iso(sunday));
    };

    /** The seven 'YYYY-MM-DD' strings of the week starting at `monday`. */
    U.weekDays = function (monday) {
        const out = [];
        for (let i = 0; i < 7; i++) out.push(U.iso(U.addDays(monday, i)));
        return out;
    };

    /* ---------------- times ---------------- */

    /** 'HH:MM' -> minutes since midnight. */
    U.toMinutes = function (hhmm) {
        const p = String(hhmm || '0:00').split(':');
        return (+p[0]) * 60 + (+p[1] || 0);
    };

    /** minutes since midnight -> 'HH:MM' (wrapping past midnight is clamped). */
    U.toClock = function (min) {
        const m = Math.max(0, Math.min(24 * 60, Math.round(min)));
        return U.pad2(Math.floor(m / 60)) + ':' + U.pad2(m % 60);
    };

    /* ---------------- formatting ---------------- */

    /**
     * 90 -> '1,5u'. Dutch comma decimals, because the users are Dutch.
     * Always hours, never days: the same formatter prints a 30-minute job and
     * a 40-hour week target, and "5 days" would be nonsense for the latter.
     */
    U.duration = function (min) {
        if (min == null) return '';
        if (min === 0) return '0u';
        if (min < 60) return min + 'm';
        const hours = min / 60;
        return String(Math.round(hours * 100) / 100).replace('.', ',') + 'u';
    };

    /** Hours as typed in a form ('3,5' or '3.5') -> minutes. */
    U.hoursToMinutes = function (value) {
        const n = parseFloat(String(value).replace(',', '.'));
        if (!isFinite(n) || n <= 0) return null;
        return Math.round(n * 60);
    };

    /** Minutes -> the string to put in an hours field, comma-style like the rest
        of the app. U.hoursToMinutes reads both commas and dots back. */
    U.minutesToHours = function (min) {
        if (min == null) return '';
        return String(Math.round((min / 60) * 100) / 100).replace('.', ',');
    };

    /** How long ago a job was created, in the words a dispatcher would use. */
    U.age = function (isoStamp) {
        const then = new Date(isoStamp);
        if (isNaN(then)) return '';
        const mins = Math.floor((Date.now() - then.getTime()) / 60000);
        if (mins < 1) return 'Added just now';
        if (mins < 60) return 'Added ' + mins + (mins === 1 ? ' minute ago' : ' minutes ago');

        const hours = Math.floor(mins / 60);
        if (hours < 24) return 'Added ' + hours + (hours === 1 ? ' hour ago' : ' hours ago');

        const days = U.daysBetween(U.iso(then), U.today());
        if (days === 1) return 'Added yesterday, ' + U.pad2(then.getHours()) + ':' + U.pad2(then.getMinutes());
        if (days < 14) return 'Added ' + days + ' days ago';

        const weeks = Math.floor(days / 7);
        if (weeks < 9) return 'Added ' + weeks + ' weeks ago';
        return 'Added ' + U.shortDate(U.iso(then));
    };

    /**
     * A deadline turned into a label and a tone.
     * tone: 'over' (passed), 'accent' (today/tomorrow), 'warn' (this week), 'plain'.
     */
    U.deadline = function (iso) {
        if (!iso) return null;
        const days = U.daysBetween(U.today(), iso);
        if (days < 0) {
            const late = -days;
            return { tone: 'over', text: late === 1 ? 'Deadline was yesterday' : late + ' days overdue' };
        }
        if (days === 0) return { tone: 'accent', text: 'Deadline today' };
        if (days === 1) return { tone: 'accent', text: 'Deadline tomorrow' };
        if (days <= 7) return { tone: 'warn', text: 'Before ' + U.shortDate(iso) };
        return { tone: 'plain', text: 'Before ' + U.shortDate(iso) };
    };

    /** 'VvE Parkzicht' -> 'VP', 'M. Jansen' -> 'MJ'. */
    U.initials = function (name) {
        const words = String(name || '').trim().split(/\s+/).filter(Boolean);
        if (!words.length) return '?';
        if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
        return (words[0][0] + words[words.length - 1][0]).toUpperCase();
    };

    U.plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

    U.id = function () {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    };

}(window));
