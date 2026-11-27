'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { selectEnquiryThreads } = require('../enquiryFeed');

const row = (over) => ({
  id: 1, thread_id: 't1', date: '2026-11-27 11:05:00', last_updated: '2026-11-27 11:06:00', sender: 'A <a@party.com>', to_details: 'enquiry@laserpowerinfra.com',
  cc_details: '[None]', subject: 'Purchase enquiry for cables', company: 'Laser', category: 'OUTSIDER', sub_category: '', user_labels: '[None]', msg_count: 1,
  attach_names: 'image001.png, BOQ.pdf', attach_links: 'http://x/1, http://x/2', body: '--- Message 1 From: A <a@party.com> ---\n\nPlease quote.', ocr_text: 'BOQ text', ...over,
});
const opts = { internalDomains: ['laserpowerinfra.com'] };

test('incoming enquiry: first sender, kind, message list and fields', () => {
  const [t] = selectEnquiryThreads([row({
    body: '--- Message 1 From: "Kori, V" <V.Kori@Party.com> ---\n\nPlease quote.\n--- Message 2 From: Sales <sales@laserpowerinfra.com> ---\n\nOffer attached.',
    sender: 'Sales <sales@laserpowerinfra.com>', msg_count: 2,
  })], opts);
  assert.deepStrictEqual([t.kind, t.first_from_email, t.latest_from, t.message_froms.length], ['incoming', 'v.kori@party.com', 'Sales <sales@laserpowerinfra.com>', 2]);
  assert.strictEqual(t.ocr_text, 'BOQ text');
});

test('our own offers are left out unless direction=all; an internal forward is kept as forwarded', () => {
  const own = row({ thread_id: 'own', subject: 'Quotation for HT cable', body: '--- Message 1 From: Sales <sales@laserpowerinfra.com> ---\n\nOur offer.' });
  const fwd = row({ thread_id: 'fwd', subject: 'Fwd: Rate enquiry', body: '--- Message 1 From: Puja <puja@laserpowerinfra.com> ---\n\nForwarded message' });
  assert.deepStrictEqual(selectEnquiryThreads([own, fwd], opts).map(t => [t.thread_id, t.kind]), [['fwd', 'forwarded']]);
  assert.deepStrictEqual(selectEnquiryThreads([own, fwd], { ...opts, direction: 'all' }).map(t => t.kind), ['outgoing', 'forwarded']);
});

test('mails without enquiry wording are left out unless all=1; a single thread is always returned', () => {
  const other = row({ subject: 'Dispatch details', body: '--- Message 1 From: A <a@party.com> ---\n\nTruck left today.', attach_names: 'LR.pdf', attach_links: 'http://x/1' });
  assert.strictEqual(selectEnquiryThreads([other], opts).length, 0);
  assert.strictEqual(selectEnquiryThreads([other], { ...opts, all: true }).length, 1);
  assert.strictEqual(selectEnquiryThreads([other], { ...opts, single: true }).length, 1);
});

test('long text keeps its start and end; attachment text can be left out; the attachment cleaner is applied', () => {
  const long = '--- Message 1 From: A <a@party.com> ---\n\nPlease quote. ' + 'x'.repeat(40000) + ' END';
  const [t] = selectEnquiryThreads([row({ body: long })], { ...opts, ocr: false, sanitize: e => ({ ...e, attach_names: 'BOQ.pdf', attach_links: 'http://x/2' }) });
  assert.ok(t.body.length < 29000 && t.body.startsWith('--- Message 1') && t.body.endsWith(' END') && /characters left out/.test(t.body));
  assert.ok(!('ocr_text' in t));
  assert.deepStrictEqual([t.attach_names, t.attach_links], ['BOQ.pdf', 'http://x/2']);
});

test('strict (the default): enquiry wording must be in the subject or an attachment name, and order / inspection / automated mails are dropped', () => {
  const b = (from) => '--- Message 1 From: ' + from + ' ---\n\nPlease quote your offer for the items.';
  const rows = [
    row({ thread_id: 'rfq', subject: 'RFQ for LT Cable' }),
    row({ thread_id: 'req', subject: 'Requirement – ACSR Wolf Conductor 3000 Mtr', attach_names: '', attach_links: '' }),
    row({ thread_id: 'att', subject: 'Bhilmi project', attach_names: 'RFQ_cables.pdf', attach_links: 'http://x/1' }),
    row({ thread_id: 'bodyonly', subject: 'Intimation Letter', attach_names: '', attach_links: '', body: b('A <a@party.com>') }),
    row({ thread_id: 'insp', subject: 'LASER: INSPECTION OFFER_O126Y-789', body: b('A <a@party.com>') }),
    row({ thread_id: 'po', subject: 'Re: Purchase Order for ACSR Moose Conductor', body: b('A <a@party.com>') }),
    row({ thread_id: 'valve', subject: 'Rate Inquiry // Valves // 23005388', body: b('A <a@party.com>') }),
    row({ thread_id: 'bot', subject: 'Changes to Sales Enquiry 3: Untitled Workflow', body: b('Smartsheet <automation@app.smartsheet.com>') }),
  ];
  assert.deepStrictEqual(selectEnquiryThreads(rows, opts).map(t => t.thread_id), ['rfq', 'req', 'att']);
  assert.deepStrictEqual(selectEnquiryThreads(rows, { ...opts, strict: false }).map(t => t.thread_id), ['rfq', 'req', 'att', 'bodyonly', 'insp', 'po', 'valve', 'bot']);
});
