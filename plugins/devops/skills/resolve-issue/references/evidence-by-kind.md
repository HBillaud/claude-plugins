# Evidence by kind of issue

What to collect in step 3, how to reproduce in step 4, and what proves the fix in step 8. Read the section that fits. An issue can be more than one kind, and the first guess can be wrong: a "flaky test" may be a real race in the product.

## Crash or exception

- **Collect:** the full stack trace, the exact input, and the version that ran.
- **Trace backwards.** The line that throws is rarely the cause. Find where the bad value was first created.
- **Beware:** a null check or default at the crash site usually hides the bad value and passes it downstream.

## Wrong output or corrupted data

- **Collect:** one concrete wrong result, the expected result, and the input behind both.
- **Narrow it:** walk the pipeline and find the first step whose output is wrong.
- **Damage:** find out which stored records, caches or exports are already wrong, and since when. Fixing the code does not repair them; report what needs repair and how. Do not run a repair on real data unless asked.

## Regression ("this used to work")

- **Collect:** the last known good version and the first known bad one.
- **Narrow it:** turn the reproduction into a script and use `git bisect run <script>`.
- **Read the guilty commit's purpose** before changing it. A plain revert brings back whatever it fixed, so the fix must satisfy both needs.

## Flaky or intermittent failure

- **Measure the rate:** run it many times and record failures out of runs. Compare the logs of a failing run and a passing one.
- **Vary one condition at a time:** test order, parallelism, seed, clock, load. Use the language's race detector where there is one.
- **Prove the fix statistically.** With a failure rate `p`, about `3/p` clean runs gives 95% confidence that the rate really fell. A few green runs prove nothing at 5%.
- **Beware:** a sleep, a longer timeout or an added retry usually hides the race. Use one only when it is the designed behaviour, and say why.

## Performance

- **Measure first:** define the metric and percentile, record a baseline on a representative workload, then profile. Do not optimise from reading code.
- **Compare distributions,** not single runs, and keep the conditions the same before and after.
- **Beware:** check that the fix does not just move the cost elsewhere, such as memory, startup time or another caller.

## CI or build failure

- **Collect:** the logs of the failing run and the last passing run, plus the event, branch, commit and environment of each.
- **Reproduce the runner's conditions:** a clean clone, the same fetch depth, the same pinned tool versions.
- **Check what changed outside the repository too:** runner image, unpinned dependencies, external services, expired credentials.
- **Beware:** a skipped job can report success. A green result only counts if the check actually ran, so look for cancelled and skipped jobs as well as failed ones.

## Deployment, infrastructure or configuration

- **Collect:** the desired state, the actual state, and the difference between them (a plan, a diff, a read-only query), along with the most recent change to either.
- **Stay read-only while investigating.** Prepare a change and a dry-run for a person to apply, unless the user has explicitly told you to apply it.
- **Beware:** fixing the live system by hand without changing its source of truth means the next deployment brings the bug back.

## Dependency or upstream defect

- **Collect:** the exact versions, a minimal reproduction with no project code, and the upstream changelog and issue tracker.
- **Fix:** prefer a released upgrade. Otherwise pin the version or add a workaround, with a comment linking the upstream issue and saying when to remove it.

## Security

- **Keep it private.** Do not describe an exploit in a public issue, pull request or commit message before the fix ships. Tell the user, and use the repository's private reporting route.
- **Confirm only as far as you are authorised to,** in your own test environment.
- **Assess exposure as well as the code:** rotate any exposed secret, since removing it from the code does not un-leak it, and say what logs could show about past use.

## Cannot reproduce

- **Compare environments:** version, operating system, configuration, data volume, locale, time zone, permissions.
- **Ask the reporter for specifics:** the exact command, the output, the version, and how often it happens. Draft those questions for the user to send.
- **If evidence is missing,** propose logging that would capture it next time, as its own change. Do not ship a speculative fix to see if the reports stop.

## Not a bug

Compare the behaviour with the documentation and the design. If the code does what was intended, the report may be a feature request, or the documentation may be the defect. Say which, with the evidence, and let the user decide what happens to the issue.
