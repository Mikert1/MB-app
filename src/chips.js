/**
 * The coloured chips every card wears, in one place.
 *
 * A card's colour comes from its status; priority is now only ever a chip of
 * its own, and custom tags bring their own colour. All of it resolves to a
 * CSS variable name, never a hex literal, so a light theme can be added by
 * swapping the palette in style.css.
 */
(function (W) {
    'use strict';

    const U = W.util;
    const Store = W.store;
    const Chips = W.chips = {};

    /** `--status-agreed` -> the colour, read from the live stylesheet. */
    Chips.tone = function (varName) {
        return varName ? 'var(' + varName + ')' : '';
    };

    Chips.tagTone = function (colorName) {
        return '--tag-' + (colorName || 'grey');
    };

    /** Paint an element with a palette colour, for the rail / dot / chip. */
    Chips.paint = function (el, varName) {
        if (el) el.style.setProperty('--tone', Chips.tone(varName));
    };

    /** A coloured chip. `solid` fills it instead of tinting it. */
    Chips.chip = function (text, varName, solid) {
        const chip = U.clone('tpl-tagChip');
        U.setText(U.roles(chip).text, text);
        Chips.paint(chip, varName);
        if (solid) chip.classList.add('solid');
        return chip;
    };

    /** A plain uncoloured chip, for facts like a duration or a deadline. */
    Chips.plain = function (text, tone) {
        const chip = U.clone('tpl-chip');
        if (tone) chip.classList.add(tone);
        U.setText(U.roles(chip).text, text);
        return chip;
    };

    /**
     * Every chip a job should wear, in reading order: where it stands, how
     * urgent it is, then its own tags. Deliberately does NOT include the
     * duration or the deadline — those differ per page.
     */
    Chips.forJob = function (job, options) {
        const opts = options || {};
        const out = [];

        const status = Store.status(job.status);
        // On My week the status is the card's colour already, so repeating it
        // as a chip would just be noise unless asked for.
        if (opts.status !== false) out.push(Chips.chip(status.label, status.tone));

        const prioTone = Store.priorityTone(job.priority);
        if (prioTone) out.push(Chips.chip(job.priority, prioTone));

        Store.tagsOf(job).forEach(tag => {
            out.push(Chips.chip(tag.name, Chips.tagTone(tag.color)));
        });

        return out;
    };

    /** Fill a chip container for a job, plus whatever extras the page adds. */
    Chips.fill = function (host, job, options) {
        const opts = options || {};
        U.empty(host);
        Chips.forJob(job, opts).forEach(chip => host.appendChild(chip));
        (opts.extra || []).forEach(chip => host.appendChild(chip));
    };

}(window));
