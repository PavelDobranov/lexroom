# Lexroom Contract Review

Lexroom supports a shared law-firm workspace in requesting and reading AI-assisted contract reviews.

## Language

**Workspace**:
The shared area containing the firm's lawyers, documents, reviews, and monthly review allowance. The MVP has exactly one workspace.

**Document**:
A contract available in the workspace for review. A document may supersede an earlier version but remains independently reviewable.

**Review**:
One requested AI analysis of one document, attributed to the lawyer who requested it. A review is either `running`, `completed`, or `failed`.
_Avoid_: Job, task, analysis

**Finding**:
A clause-level concern emitted during a review, with a severity and explanation. Findings emitted by a running review are not a completed review result; a completed review with none is presented as “No issues flagged.”
_Avoid_: Issue or warning as names for the domain concept

**Latest successful review**:
The most recent completed review for a document. It remains accessible when a newer review is running or has failed and is clearly separated from that attempt.
_Avoid_: Current review, latest attempt

**Monthly review allowance**:
The workspace-wide limit of ten completed reviews in a UTC calendar month. It resets at 00:00 UTC on the first day of each month, and failed reviews do not consume it.
_Avoid_: Credits, balance

**Reservation**:
A temporary claim on the monthly review allowance held by a running review for the UTC month in which it was requested. It is consumed for that month when the review completes and released when the review fails.
_Avoid_: Charge, queued review

**Exhausted allowance**:
The condition in which all ten reviews for the month have completed, so no review can start until the next month.

**Temporarily reserved capacity**:
The condition in which unconsumed allowance exists but is entirely reserved by running reviews. A review may start after a reservation is released, without waiting for the next month.
