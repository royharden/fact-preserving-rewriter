# Limitations

**Source complete, provisioning pending, runtime unverified.** Nothing has been installed, built, typechecked, linted, tested, evaluated or app-run. Source inspection and syntax parsing cannot establish correctness, security, rendering, dependency compatibility or deployed readiness. There are no measured results or independently validated successes. [DEFERRED-VALIDATION.md](DEFERRED-VALIDATION.md) lists the outstanding work.

## What preservation means

Checks compare a rewrite with its source, not external truth. Keeping names and quantities does not prove who did what to whom, causality, conditions, attribution, chronology, negation or modal strength. Entity/number swaps can preserve the lexical inventory. Overlap is not entailment; alignment can miss paraphrases and sentence splits/merges. Number/date blanking deliberately leaves those facts to the deterministic checker. Short claims can be excluded by overlap's minimum-word threshold. Thresholds are uncalibrated until future dev work; the local freeze does not configure deployed constants.

Soft checks count selected words/phrases in positionally paired paragraphs. Reordered claims can balance counts while moving meaning. A paragraph-count mismatch always raises the conservative `paragraph_alignment_uncertain` advisory, including benign reflow. Neither that flag nor user acknowledgement proves preservation. A human override deliberately permits failed output and must be treated as such.

The bounded optional LLM judge can be wrong or unavailable and covers at most 120 aligned pairs on the selected B4 attempt. Uncovered evidence prevents a clean pass. Its selected-attempt role remains in source; **the optional LLM comparative corpus calibration/ablation is cut**. No LLM corpus detection/false-alarm result is available. **Jev: not evaluated.**

## Known extractor boundaries

- Numbers drop negative signs (`-5` reads as 5). European separators, most spelled fractions and composite magnitudes such as “two million three hundred thousand” are not fully recognized. Bare attached `s` is seconds only up to three digits, avoiding decades such as `1990s`. `$5-7M` applies the right magnitude to both ends.
- Only `50% of the <noun>` maps to the same half-fraction head as `half the <noun>`; other percentages keep percentage normalization. Bare unresolved `half` is advisory rather than a hard fact. Quantity/unit coverage is heuristic.
- Date precision must match. Year-less dates inherit chrono's implied year from the frozen reference instant. Relative and ambiguous numeric dates require exact raw text. Written zones are retained, not converted. Recognition/filter assumptions about “next Friday”, slash dates, zone spans, lower-case month words and durations remain untested against pinned chrono-node.
- Entity recognition uses capitalization, not entity understanding. Sentence-initial/Markdown-heading words need a license from another occurrence, acronym/mixed case or protection. Colon/parenthesis capitalization counts mid-sentence. Multiword entities match as a whole; `Acme Cloud` becoming `Acme` needs an explicit alias. Alias/toggle decisions can weaken coverage.
- Verbatim inside a complete quote is absorbed into the quote; partial overlap gives verbatim priority. Straight single-quote recognition has word-boundary rules and can miss quotation styles. Exact preservation of recognized spans says nothing about unrecognized spans.
- `Intl.Segmenter`/ICU boundaries, title-abbreviation merging and line-break behavior depend on runtime assumptions. UTF-16 offsets are not byte or user-perceived-character positions. The same source occurrence exemption for added facts can suppress real corruption detections; the evaluator is designed to report that recall cost.

## Evidence and evaluation boundaries

B4 constructs and scores with the same checker, so favorable B4 self-scores are circular. Gold annotations, scripts, mutators and known-good paraphrases are agent-authored; they are not independent human validation. The small synthetic corpus covers three genres and cannot establish generalization. Two voices share each source, so pair-level Wilson intervals are descriptive; source-cluster summaries must be read beside them. Dev target gates are proposals, and target misses must remain visible.

Demo and generated recording rows are **mock (scripted outputs)**. Generated recordings reproduce authored scripts, not actual provider executions. B0/B1 are **computed, no model call** only after their computation runs. Live model rows are **not yet measured** until backed by actual authenticated deployed-function calls and ledger IDs. Failed/partial outcomes must stay in denominators; bounded live subsets cannot be extrapolated. A 20-output spot-check sheet contains null human labels until an independent reviewer completes it.

`gutenberg-placeholder.md` is builder-authored **PLACEHOLDER — not Gutenberg**. No Gutenberg text was retrieved and provenance is unverified. It cannot support a claim about the intended literary voice. Replacing it changes the corpus and requires a reviewed new calibration/evaluation edition, retaining old evidence.

## Operational boundaries

English plain text/Markdown only; no HTML interpretation, URL fetching, rich-document import, tables/PDF/DOCX support, batch processing, extension or in-browser edit-and-recheck. Style distance is descriptive, can reward shallow changes and is disabled below 600 sample words. Zero-variance features are skipped; short demo samples do not produce a distance.

Anonymous session loss can make server history inaccessible. Browser-local demo rulings do not enforce server security. Live sources/samples are stored and sent to the configured model provider; erasure does not retract provider disclosures, delete the Auth identity or revoke copies already exported. Pseudonymous accounting residue is retained to preserve caps. Browser storage/clipboard denial and concurrent-tab behavior require manual validation.

Provider models, price units, pinned dependency compatibility, gateway/auth behavior, Deno imports, generated-copy parity, SQL/RLS, budget races, unknown-outcome recovery and UI accessibility/layout are all unverified. UTF-8-byte token estimation is a conservative assumption for byte-based tokenizers, not an invoice guarantee. Post-dispatch uncertainty retains reservation and may need privileged owner recovery. A readiness probe is a point-in-time check, not authorization or a guarantee of later budget/completion. No hosting/publication or infrastructure action has occurred.
