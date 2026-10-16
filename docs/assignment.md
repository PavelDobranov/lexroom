## Use case

Lawyers and legal teams use Lexroom to research, draft and review with AI. This exercise is about the review: an AI review of a contract is slow, it sometimes fails, and each successful one counts against the law firm's monthly plan.

Implement the contract review flow of a law firm's workspace, shared by three lawyers, where:

- a lawyer sees the workspace's documents and, for each one, the state of its latest review
- a lawyer requests an AI review of a document and follows it until it completes or fails
- a lawyer reads the result of a completed review: the clauses the AI flagged, each with its severity and explanation

### Rules

- The plan includes 10 reviews per calendar month for the whole workspace. Reviews that fail don't count against it
- A document can have at most one review in progress at a time, whoever requested it
- The AI review is FAKE: it returns the findings listed for that document in `samples/documents.json` one at a time, spread over 5 to 30 seconds. About 1 time in 5 it fails with an error instead of finishing, after having returned some of the findings or none. About 1 time in 10 it is slow, and finishes only after 60 to 120 seconds
- A review still in progress 60 seconds after it was requested has failed permanently. Findings or completion arriving later must not turn it into a completed review or consume the plan. A retry is a new review
- There is no authentication: who is using the app is chosen in the interface, among the three lawyers in `samples/lawyers.json`

### Two people who want different things

Product and the customer have both looked at this flow, and they don't agree.

The product manager:

> "A lawyer must never wait in front of nothing: while a new review runs, keep the previous one on screen. Show each finding as soon as the AI returns it, instead of making people wait for the whole list. And when the plan is used up, take the request anyway and run it when the plan resets, so nobody has to remember to come back."
> 

The senior partner of the firm, our customer:

> "A lawyer must never mistake an old or partial result for the final one: whatever isn't final must be impossible to read as final. Nobody spends one of our ten reviews without knowing it. And nobody should believe a review is on its way when it won't start for three weeks."
> 

The three points, decide on each of them:

- The previous review while a new one runs
- Findings before the review has finished
- Requests beyond the plan

**Note:** Uploading files, parsing documents, authentication, billing and the integration with a real AI model are NOT requirements. One workspace is enough.