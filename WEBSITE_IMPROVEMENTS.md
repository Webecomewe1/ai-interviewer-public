# Website audit and improvement plan

Research checked: October 24, 2026. This report describes the website changes and the follow-up research. API safeguards and deployment requirements are covered in [API_ABUSE_PROTECTION.md](API_ABUSE_PROTECTION.md).

## Findings and evidence

The app already offers voice/text interviews, role and difficulty settings, resume/job context, transcripts, six feedback dimensions, and account history. Its largest gap was helping a new visitor reach and understand that functionality.

| Finding | Effect | Implemented response |
| --- | --- | --- |
| The advanced-options wrapper also contained the start button | A first-time visitor could not see how to start | Closed the wrapper before the session summary and primary action |
| Long setup without a clear starting point | Too many choices before any practice | Three presets with editable settings and a live session summary |
| The first meaningful experience required an account and AI availability | Visitors could not try the approach immediately | Five sample behavioral questions, STAR prompts, editable answer drafts and an explicit self-review checklist |
| Personalization competed with advanced settings | Existing resume/job context was easy to miss | Renamed the disclosure, explained its purpose, and added clear data-use copy |
| Role-only cached questions ignored supplied context | Personalized sessions could start with generic questions | Context-bearing sessions bypass shared cache reads and writes |
| Resume, job and company context were absent from the persistence schema and restore path | Personalization disappeared after a server restart | Persist and restore those fields for newly saved sessions |
| Results ended with scores and general suggestions | Users had to decide how to practice next | Lowest-scored-skill plan and a button to prepare a five-question follow-up session |
| Service errors exposed deployment terms | Visitors saw configuration details instead of useful recovery | Plain-language unavailable states, retry, text fallback and a local warm-up |
| Shared visual system relied on competing glows and remote fonts | Weak hierarchy and extra external requests | Restrained green palette, system typography, early theme selection, light/dark support |

The warm-up is deterministic self-practice, not AI analysis. It does not assess correctness, STAR completeness, speaking quality, or interview readiness. Its drafts stay in page memory, survive question switching, and disappear on reload.

## Research informing the changes

### Demonstrate skills with specific examples

[NACE, Job Outlook 2026 Spring Update](https://www.naceweb.org/research/reports/job-outlook/) reports that nearly 70% of respondents use skills-based hiring. It recommends candidates prepare examples of situations in which they applied skills to solve problems. The survey ran February 12-March 17, 2026, with 185 total employer respondents. It concerns U.S. college recruiting and should not be generalized to every country or career level.

**Product implication:** Help early-career users turn coursework, projects and work experience into clear stories. The STAR warm-up and short behavioral preset apply that idea. This is a design inference, not evidence that this app improves hiring outcomes.

### Make practice relevant to the role

[LinkedIn, Future of Recruiting 2025](https://www.linkedin.com/business/talent/blog/talent-acquisition/future-of-recruiting-2025) reports that 93% of talent acquisition professionals consider accurate skills assessment crucial to improving quality of hire. Its research combines platform data, responses from more than 1,000 talent professionals and expert input.

**Product implication:** Resume and job context should affect generated questions, remain available when a session resumes, and never be fed into a shared generic question pool. The cache and persistence fixes make the existing personalization more reliable. The report does not establish an app conversion or interview success rate.

### Reduce friction and close the practice loop

[Yoodli's interview practice documentation](https://support.yoodli.ai/en/articles/9550465-practice-with-yoodli) describes role/company setup, interviewer demeanor, preset and dynamic follow-up questions, and post-session analysis. [Exponent/Aced's AI mock interview page](https://www.tryexponent.com/practice/ai-mock-interviews) offers audio practice and actionable AI feedback.

**Product implication:** Useful competitive benchmarks are a quick start, context-specific practice, follow-ups and actionable review. This release improves setup and adds a clear next-session action. Competitor pages describe advertised capabilities; no comparative quality, usage, pricing or outcome claims are made here.

## Design audit

- Preserved: Hotsilog name and wordmark, green brand cue, all five page URLs, existing form identifiers and field sequence, voice/text modes, history and export features, skip links and theme toggle.
- Evolved: reduced competing violet/cyan decoration, improved spacing and hierarchy, moved author attribution to the footer, used the real interactive warm-up as the secondary visual.
- Foundation: existing buildless HTML/JavaScript with Vite and CSS variables; no new runtime dependencies.
- Design settings: variance 5, motion 3, density 4. Interaction transitions remain restrained; existing reduced-motion support remains.
- Accessibility: setup comes before the warm-up in both DOM and visual order, button choices expose selection state, mode radios support arrow keys, custom inputs validate before sign-in, errors and session summaries have status announcements.
- SEO: preserved page routes and the brand title, improved the home description. No search analytics or ranking baseline was available; no SEO outcome is claimed.

## Next priorities

| Priority | Improvement | Why it matters | Acceptance criteria |
| --- | --- | --- | --- |
| High | Evidence-linked feedback and calibrated rubrics | A score is less useful than knowing which answer supports it | Each feedback item cites an actual answer, states an improvement, and gives a grounded rewrite; assess consistency with a reviewed benchmark set |
| High | Transcript access during feedback outages | The follow-up API fix now propagates evaluation/quota errors without invented scores and supports retries | Add a dedicated transcript-only view so a feedback outage does not block transcript review |
| High | Staging validation of shared quotas and ownership | The follow-up fix enforces REST/voice ownership with negative integration tests and adds durable quotas | Check database permissions, real proxy routing, multi-worker operation and provider behavior in staging |
| High | Opt-in context retention and account data controls | Setup context is saved on the device; personalized sessions now retain context with account data | Explicit retention policy, opt-in device storage, per-session deletion, export and verified deletion behavior |
| Medium | Progress comparisons for equivalent sessions | A single overall score does not show learning | Compare the same role, mode, rubric and difficulty; show session count and explain that AI scores can vary |
| Medium | Voice device check and reconnection recovery | Audio failure interrupts an otherwise useful experience | Mic selection and permission guidance, audible test, connection recovery, accessible text fallback |
| Medium | Broader role coverage and targeted question sets | Current visible roles primarily target IT applicants | Curated role tracks, question quality review and relevant evaluation criteria for each track |
| Medium | Answer retry and story library | Improvement requires repetition on the same answer | Save a story deliberately, revise it, and compare versions without claiming an objectively better score |

These are future recommendations, not features shipped in this change. Security findings above are based on code review, not a penetration test or a verified production exploit.

## Measurement plan

Instrumentation was not added because analytics infrastructure and consent requirements were not established. Suggested aggregate events are setup view, warm-up engagement, preset selection, start attempt, successful start, completion, results view and focused-practice setup. Never include resumes, answers, transcripts, email addresses or job descriptions in analytics payloads.

Track successful starts / setup visitors, completions / successful starts, repeat practice within seven days, time to first question, voice connection errors, and feedback usefulness ratings. Separate text and voice sessions. Establish a baseline before setting improvement targets; no conversion uplift is claimed.

## Verification

- Production build: passed for all five pages.
- Backend regression tests: context reaches prompts, personalized cache isolation, generic cache behavior, restored context and custom-role validation.
- Results-controller regression tests: lowest-score selection, five-question technical/behavioral follow-up settings, retained role/context, and missing-evaluation behavior. The follow-up abuse protection tests are described in API_ABUSE_PROTECTION.md.
- Browser checks: light/dark layout, visible primary action with personalization collapsed, quick presets, session summary, STAR prompts, word counts, checklist, and offline state.
- Live Gemini, database persistence and voice/audio were not exercised against real services. Automated performance/Lighthouse and a physical mobile browser were not available in this session; responsive CSS was reviewed but is not a substitute for device QA.

Run the regression tests with `npm test`. Build with the existing root build script. Use staging credentials to verify persistence, live AI behavior, proxy settings and account ownership before production release.
