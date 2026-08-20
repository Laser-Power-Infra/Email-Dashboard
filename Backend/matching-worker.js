const { parentPort } = require('worker_threads');
const { checkMatchCompiled, strictCheckMatchCompiled } = require('./matcher');

parentPort.on('message', ({ tenderChunk, threads, blacklistedSenders }) => {
  const matches = [];

  try {
    // Reconstruct RegExp objects locally inside the worker thread context
    const reconstructedTenders = tenderChunk.map(tender => {
      if (!tender.compiledRegexes) return tender;
      return {
        ...tender,
        compiledRegexes: tender.compiledRegexes.map(item => ({
          token: item.token,
          regex: new RegExp(item.regexSource, item.regexFlags)
        }))
      };
    });

    for (const tender of reconstructedTenders) {
      if (!tender.docketNo) continue;
      if (!tender.compiledRegexes || tender.compiledRegexes.length === 0) continue;

      // Participated tenders use strict (exact) matching; non-participated use
      // flexible matching with context keyword validation.
      const matchFn = tender.isParticipated ? strictCheckMatchCompiled : checkMatchCompiled;

      for (const thread of threads) {
        const senderLower = (thread.sender || '').toLowerCase();
        let isBlacklisted = false;
        for (const bl of blacklistedSenders) {
          if (senderLower.includes(bl)) {
            isBlacklisted = true;
            break;
          }
        }
        if (isBlacklisted) continue;

        const matchResult = matchFn(
          tender.compiledRegexes,
          thread.normSubject,
          thread.normBody,
          thread.normOcr
        );

        if (matchResult.matched) {
          matches.push({
            docketNo: tender.docketNo,
            tenderNo: tender.tenderNoRaw,
            threadDbId: thread.id,
            threadId: thread.thread_id,
            matchedToken: matchResult.matchedToken,
            confidence: matchResult.confidence,
            threadDate: thread.date,
            threadAiSummary: thread.ai_summary,
          });
        }
      }
    }
  } catch (err) {
    console.error("Worker matching error stack:", err.stack);
  }

  parentPort.postMessage(matches);
});
