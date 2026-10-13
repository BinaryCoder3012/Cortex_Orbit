// Develops a sample plate so a fresh install has a sky to look at.
// Everything here is synthetic demonstration material, labelled "Sample".
// Run with `npm run seed`; pass --reset to wipe the vault first.
import './env.ts';

import { DAY_MS, sm2, freshMemory, type CardKind, type ConceptKind, type EdgeType } from '@cortex/core';
import { db, run, tx } from './db.ts';
import * as repo from './repo.ts';
import { chunkText } from './ingest/chunk.ts';

type C = [name: string, kind: ConceptKind, importance: number, summary: string, aliases?: string[]];
type K = [concept: string, kind: CardKind, prompt: string, answer: string, options?: string[]];

interface Plate {
  title: string;
  daysAgo: number;
  text: string;
  concepts: C[];
  edges: [string, string, EdgeType][];
  cards: K[];
}

const plates: Plate[] = [
  {
    title: 'Sample: React state, from props to stores',
    daysAgo: 38,
    text: `# React state, from props to stores

Props are the read-only inputs a parent passes to a child component. A component never mutates its props; when the parent re-renders with new props, the child re-renders too. This one-way data flow is what makes React UIs predictable.

State is data a component owns and can change over time. The useState hook returns the current value and a setter; calling the setter schedules a re-render. State updates are batched, so reading state immediately after setting it still gives the old value.

Hooks are functions that let function components use React features. The Rules of Hooks say hooks must be called at the top level, in the same order on every render, and only from React functions. React relies on call order to match each hook with its stored state.

useEffect runs side effects after React commits a render: subscriptions, timers, fetching. Its dependency array tells React when to re-run the effect; an empty array runs it once after mount. Returning a function from the effect registers a cleanup that runs before the next effect and on unmount.

Prop drilling is passing props through intermediate components that do not need them, only so a deeply nested child can read them. It is a symptom that state lives too far from where it is used, and it makes refactoring brittle.

Lifting state up means moving state to the closest common ancestor of the components that need it, then passing it down. It is the first fix for two siblings that must stay in sync, but lifted too far it causes prop drilling.

Redux is a predictable state container: the whole app state lives in a single store, changes are described by plain-object actions, and pure reducer functions compute the next state from the previous state and an action. Because reducers are pure, Redux makes state changes replayable and easy to debug with time-travel tools.

A reducer is a pure function (state, action) => newState. It must not mutate its arguments or perform side effects. The same idea appears in React itself as the useReducer hook, which manages complex local state with a reducer instead of many useState calls.

useMemo caches the result of an expensive calculation between renders and recomputes only when its dependencies change. It is an optimisation, not a semantic guarantee: React may discard the cache. Reach for it after measuring, not before.`,
    concepts: [
      ['Props', 'term', 4, 'Read-only inputs a parent passes to a child component; children never mutate them, which keeps data flowing one way.'],
      ['useState', 'tool', 5, 'A hook that gives a function component a piece of state and a setter; calling the setter schedules a re-render, and updates are batched.', ['State']],
      ['Hooks', 'idea', 5, 'Functions that let function components use React features such as state and effects, matched to stored data by call order.', ['React Hooks']],
      ['Rules of Hooks', 'principle', 4, 'Call hooks only at the top level and only from React functions, in the same order every render, because React matches hooks by call order.'],
      ['useEffect', 'tool', 4, 'Runs side effects after a render commits; the dependency array decides when it re-runs, and a returned function is its cleanup.'],
      ['Prop Drilling', 'pattern', 3, 'Threading props through components that do not need them so a deep child can read them; a sign state lives too far from where it is used.'],
      ['Lifting State Up', 'technique', 3, 'Moving state to the closest common ancestor of the components that share it, then passing it down as props.'],
      ['Redux', 'tool', 4, 'A predictable state container: one store, plain-object actions describe changes, and pure reducers compute the next state.'],
      ['Reducer', 'idea', 4, 'A pure function (state, action) => newState with no mutation and no side effects, so state changes are replayable.', ['Reducers']],
      ['useMemo', 'tool', 2, 'Caches an expensive calculation between renders until its dependencies change; an optimisation React may discard, not a guarantee.'],
    ],
    edges: [
      ['Hooks', 'useState', 'prerequisite'],
      ['Hooks', 'useEffect', 'prerequisite'],
      ['Rules of Hooks', 'Hooks', 'part_of'],
      ['Props', 'Prop Drilling', 'prerequisite'],
      ['Lifting State Up', 'Prop Drilling', 'related'],
      ['useState', 'Lifting State Up', 'prerequisite'],
      ['Reducer', 'Redux', 'prerequisite'],
      ['Redux', 'Prop Drilling', 'contrasts'],
      ['Hooks', 'useMemo', 'prerequisite'],
      ['Props', 'useState', 'contrasts'],
    ],
    cards: [
      ['Props', 'qa', 'Why does a child component never modify its own props?', 'Props belong to the parent; data flows one way, so the child re-renders with new props instead of mutating them.'],
      ['Props', 'cloze', 'Data in React flows {{one way}}: from parent to child through props.', 'one way'],
      ['useState', 'qa', 'You call setCount(count + 1) and log count on the next line. What prints, and why?', 'The old value: the setter schedules a re-render and updates are batched, so the current render still sees the old state.'],
      ['useState', 'mcq', 'What does calling a useState setter do?', 'Schedules a re-render with the new value', ['Schedules a re-render with the new value', 'Mutates the state variable immediately', 'Forces a synchronous DOM update', 'Re-mounts the component']],
      ['Hooks', 'qa', 'How does React know which stored state belongs to which hook call?', 'By call order: hooks are matched to stored state by the order they are called on each render.'],
      ['Rules of Hooks', 'qa', 'Why can a hook not be called inside an if statement?', 'Conditional calls change the call order between renders, so React would match hooks to the wrong stored state.'],
      ['Rules of Hooks', 'cloze', 'Hooks must be called at the {{top level}} of a React function, never in loops or conditions.', 'top level'],
      ['useEffect', 'qa', 'What does an empty dependency array do to a useEffect?', 'It runs the effect once after the first mount, and its cleanup on unmount.'],
      ['useEffect', 'mcq', 'When does a useEffect cleanup function run?', 'Before the next effect run and on unmount', ['Before the next effect run and on unmount', 'Immediately after the effect', 'Only when the page reloads', 'Before the first render']],
      ['Prop Drilling', 'qa', 'What is prop drilling a symptom of?', 'State living too far from the components that use it, so intermediate components pass props they do not need.'],
      ['Lifting State Up', 'qa', 'Two sibling inputs must always show the same value. What is the first fix?', 'Lift the state to their closest common ancestor and pass the value and setter down as props.'],
      ['Redux', 'qa', 'What makes Redux state changes replayable?', 'Every change is a plain-object action handled by a pure reducer, so replaying the actions reproduces the state.'],
      ['Redux', 'cloze', 'In Redux the whole application state lives in a single {{store}}.', 'store'],
      ['Reducer', 'qa', 'Name the two things a reducer must never do.', 'Mutate its arguments, or perform side effects.'],
      ['Reducer', 'mcq', 'Which React hook manages local state with a reducer?', 'useReducer', ['useReducer', 'useMemo', 'useEffect', 'useRef']],
      ['useMemo', 'qa', 'Why is useMemo not a semantic guarantee?', 'React may discard the cached value, so code must still be correct if the calculation runs again.'],
    ],
  },
  {
    title: 'Sample: How databases keep their promises',
    daysAgo: 24,
    text: `# How databases keep their promises

A transaction groups several reads and writes into one logical unit. ACID names the guarantees a transaction gets: Atomicity (all or nothing), Consistency (constraints hold before and after), Isolation (concurrent transactions do not see each other's partial work), and Durability (once committed, it survives a crash).

Write-Ahead Logging is how most databases deliver atomicity and durability. Before a change touches the data pages on disk, a record describing it is appended to the log and flushed. After a crash, the database replays the log to redo committed work and undo uncommitted work.

An index is a separate structure that lets the database find rows without scanning the whole table. Most relational databases build indexes as B+ trees. Indexes speed up reads but slow down writes, because every insert and update must also maintain each index.

A B+ tree is a balanced tree in which all values live in the leaves and the leaves are linked in order. Its high fan-out keeps the tree shallow, so a lookup touches only a few disk pages, and the linked leaves make range scans cheap.

Isolation levels trade correctness for concurrency. Read Committed prevents dirty reads; Repeatable Read also prevents non-repeatable reads; Serializable behaves as if transactions ran one at a time. Weaker levels allow anomalies such as phantom reads and lost updates.

MVCC, multi-version concurrency control, lets readers see a consistent snapshot without blocking writers. Each write creates a new version of a row tagged with the transaction that made it; a reader picks the versions visible to its snapshot. PostgreSQL implements its isolation levels on top of MVCC.

Normalization organises tables so each fact is stored once. First Normal Form requires atomic column values; Second removes partial dependencies on a composite key; Third removes transitive dependencies, so non-key columns depend on the key, the whole key, and nothing but the key. Normalised schemas avoid update anomalies at the cost of more joins.

A query planner turns SQL into an execution plan, choosing join orders and whether to use an index or a sequential scan based on table statistics. EXPLAIN shows the plan it picked.`,
    concepts: [
      ['Transaction', 'idea', 4, 'A group of reads and writes treated as one logical unit that either fully happens or does not happen at all.', ['Transactions']],
      ['ACID', 'principle', 5, 'Atomicity, Consistency, Isolation, Durability: the four guarantees a database transaction provides.'],
      ['Write-Ahead Logging', 'technique', 4, 'Append and flush a log record describing each change before touching data pages, so a crash can be recovered by replaying the log.', ['WAL']],
      ['Index', 'idea', 4, 'A separate structure that finds rows without a full table scan; speeds reads but slows writes, since every write maintains it.', ['Indexes', 'Database Index']],
      ['B+ Tree', 'idea', 4, 'A balanced, high fan-out tree with all values in linked leaves: shallow lookups in few page reads, and cheap range scans.', ['B+ Trees', 'B-Tree']],
      ['Isolation Levels', 'idea', 4, 'Settings that trade correctness for concurrency, from Read Committed up to Serializable, each ruling out more anomalies.'],
      ['MVCC', 'technique', 4, 'Multi-version concurrency control: writes create new row versions so readers see a consistent snapshot without blocking writers.', ['Multi-Version Concurrency Control']],
      ['Normalization', 'technique', 4, 'Structuring tables so each fact is stored once (1NF, 2NF, 3NF), avoiding update anomalies at the cost of more joins.', ['Database Normalization']],
      ['Third Normal Form', 'principle', 3, 'Non-key columns depend on the key, the whole key, and nothing but the key: no partial or transitive dependencies.', ['3NF']],
      ['Query Planner', 'tool', 3, 'Turns SQL into an execution plan, choosing join order and index versus scan from table statistics; EXPLAIN shows its choice.', ['Query Optimizer']],
    ],
    edges: [
      ['Transaction', 'ACID', 'prerequisite'],
      ['Write-Ahead Logging', 'ACID', 'part_of'],
      ['B+ Tree', 'Index', 'part_of'],
      ['Index', 'Query Planner', 'prerequisite'],
      ['Isolation Levels', 'ACID', 'part_of'],
      ['MVCC', 'Isolation Levels', 'prerequisite'],
      ['Normalization', 'Third Normal Form', 'prerequisite'],
      ['Transaction', 'Isolation Levels', 'prerequisite'],
      ['MVCC', 'Write-Ahead Logging', 'contrasts'],
    ],
    cards: [
      ['Transaction', 'qa', 'What does it mean that a transaction is "all or nothing"?', 'Either every read and write in it takes effect, or none does; a failure halfway leaves no partial changes.'],
      ['ACID', 'cloze', 'The D in ACID, {{Durability}}, means committed work survives a crash.', 'Durability'],
      ['ACID', 'mcq', 'Which ACID property stops concurrent transactions seeing each other’s partial work?', 'Isolation', ['Isolation', 'Atomicity', 'Consistency', 'Durability']],
      ['Write-Ahead Logging', 'qa', 'In WAL, what must be on disk before a data page is changed?', 'A log record describing the change, appended and flushed first.'],
      ['Write-Ahead Logging', 'qa', 'After a crash, what does the database do with the log?', 'Replays it: redoes committed work and undoes uncommitted work.'],
      ['Index', 'qa', 'Why does adding an index slow down inserts?', 'Every insert or update must also maintain each index on the table.'],
      ['B+ Tree', 'qa', 'Why are B+ trees good at range scans?', 'All values live in the leaves and the leaves are linked in key order, so a scan walks sideways along them.'],
      ['B+ Tree', 'cloze', 'A B+ tree stays shallow because of its high {{fan-out}}.', 'fan-out'],
      ['Isolation Levels', 'mcq', 'Which is the weakest of these levels?', 'Read Committed', ['Read Committed', 'Repeatable Read', 'Serializable', 'Snapshot']],
      ['Isolation Levels', 'qa', 'Name two anomalies weaker isolation levels allow.', 'Phantom reads and lost updates (also non-repeatable reads below Repeatable Read).'],
      ['MVCC', 'qa', 'How does MVCC let readers avoid blocking writers?', 'Writers create new row versions; each reader sees the versions visible to its own snapshot.'],
      ['Normalization', 'qa', 'What problem does normalization prevent, and what does it cost?', 'Update anomalies from duplicated facts; it costs more joins.'],
      ['Third Normal Form', 'cloze', 'In 3NF, non-key columns depend on the key, the whole key, and {{nothing but the key}}.', 'nothing but the key'],
      ['Query Planner', 'qa', 'What does the query planner use to choose between an index and a sequential scan?', 'Table statistics, estimating which plan reads fewer pages.'],
    ],
  },
  {
    title: 'Sample: Notes on how memory fades',
    daysAgo: 9,
    text: `# Notes on how memory fades

The forgetting curve, first measured by Hermann Ebbinghaus in 1885, shows recall dropping steeply in the first days after learning and then levelling off. Each successful review flattens the curve, so the next drop is slower.

Spaced repetition schedules reviews at growing intervals, just before an item would be forgotten. The SM-2 algorithm multiplies the interval by an ease factor after each successful review and resets it after a failure.

Retrieval practice means pulling an answer out of memory instead of rereading it. The effort of recall is what strengthens memory, which is why testing beats highlighting.

Interleaving mixes different topics in one study session instead of blocking them. It feels harder, but it forces you to choose the right approach each time, which improves transfer.

The Feynman Technique: explain a concept in plain words as if to a beginner, find where the explanation breaks down, and go back to the source to fill that gap.`,
    concepts: [
      ['Forgetting Curve', 'idea', 5, 'Recall drops steeply in the days after learning, then levels off; each successful review flattens the curve.', ['Ebbinghaus Curve']],
      ['Spaced Repetition', 'technique', 5, 'Reviewing at growing intervals timed just before an item would be forgotten.'],
      ['SM-2', 'tool', 3, 'A spaced-repetition scheduler that multiplies the interval by an ease factor after each pass and resets it after a failure.', ['SuperMemo 2']],
      ['Retrieval Practice', 'technique', 4, 'Pulling answers out of memory rather than rereading; the effort of recall is what strengthens memory.', ['Active Recall']],
      ['Interleaving', 'technique', 3, 'Mixing topics within a session instead of blocking them, which feels harder but improves transfer.'],
      ['Feynman Technique', 'technique', 3, 'Explain a concept plainly as if to a beginner, find where the explanation breaks, and return to the source.'],
    ],
    edges: [
      ['Forgetting Curve', 'Spaced Repetition', 'prerequisite'],
      ['Spaced Repetition', 'SM-2', 'prerequisite'],
      ['Retrieval Practice', 'Spaced Repetition', 'related'],
      ['Feynman Technique', 'Retrieval Practice', 'related'],
      ['Interleaving', 'Retrieval Practice', 'related'],
    ],
    cards: [
      ['Forgetting Curve', 'qa', 'What happens to the forgetting curve after a successful review?', 'It flattens: the next decline is slower than the last.'],
      ['Spaced Repetition', 'qa', 'When is the ideal moment to review an item?', 'Just before you would forget it.'],
      ['SM-2', 'qa', 'What does SM-2 do to the interval after a failed review?', 'Resets it to the start (one day) and lowers the ease factor.'],
      ['Retrieval Practice', 'mcq', 'Which study habit strengthens memory most?', 'Testing yourself without notes', ['Testing yourself without notes', 'Rereading the chapter', 'Highlighting key lines', 'Copying notes neatly']],
      ['Interleaving', 'qa', 'Why does interleaving improve transfer even though it feels harder?', 'It forces you to choose the right approach for each problem instead of repeating one.'],
      ['Feynman Technique', 'cloze', 'In the Feynman Technique you explain an idea as if to a {{beginner}} to find where your understanding breaks.', 'beginner'],
    ],
  },
];

// How each concept has been treated: [days since last review, interval, reps].
// The mix produces bright, steady, dimming and ghost stars on the plate.
const profiles: Record<string, [number, number, number] | null> = {
  Props: [3, 30, 5], useState: [2, 22, 4], Hooks: [5, 40, 5], 'Rules of Hooks': [9, 6, 2],
  useEffect: [12, 6, 2], 'Prop Drilling': [20, 6, 2], 'Lifting State Up': [6, 15, 3], Redux: [19, 6, 2],
  Reducer: [4, 15, 3], useMemo: null,
  Transaction: [1, 25, 4], ACID: [2, 30, 5], 'Write-Ahead Logging': [8, 6, 2], Index: [3, 15, 3],
  'B+ Tree': [11, 6, 2], 'Isolation Levels': [14, 3.5, 1], MVCC: null, Normalization: [2, 12, 3],
  'Third Normal Form': [6, 6, 2], 'Query Planner': null,
  'Forgetting Curve': [1, 6, 2], 'Spaced Repetition': [1, 6, 2], 'SM-2': null, 'Retrieval Practice': [3, 6, 2],
  Interleaving: null, 'Feynman Technique': [4, 1, 1],
};

const gaps: [name: string, summary: string, reason: string, between: string[]][] = [
  ['Context API', 'React’s built-in way to pass a value deep into the tree without threading props through every level.', 'You know Redux and Prop Drilling but not the built-in bridge between them: Context is how React itself avoids drilling before you reach for a store.', ['Redux', 'Prop Drilling', 'Props']],
  ['useReducer', 'A hook that manages local component state with a reducer function instead of several useState calls.', 'You have Reducer and useState catalogued separately; useReducer is where they meet inside a component.', ['Reducer', 'useState', 'Hooks']],
  ['Two-Phase Locking', 'A concurrency protocol where a transaction acquires all its locks before releasing any, guaranteeing serializability.', 'You know Isolation Levels and MVCC; two-phase locking is the classic alternative MVCC is usually contrasted with.', ['Isolation Levels', 'MVCC', 'Transaction']],
];

export function seed(reset = false) {
  if (reset) db.exec('DELETE FROM reviews; DELETE FROM gaps; DELETE FROM sources; DELETE FROM concepts;');
  const now = Date.now();
  const ago = (d: number) => new Date(now - d * DAY_MS);

  tx(() => {
    for (const p of plates) {
      const sid = repo.createSource('note', p.title, null, p.text);
      run(`UPDATE sources SET created_at = ?, status = 'fixed' WHERE id = ?`, ago(p.daysAgo).toISOString(), sid);
      const passages = chunkText(p.text);
      const chunkIds = repo.insertChunks(sid, passages);

      const ids = new Map<string, number>();
      for (const [name, kind, importance, summary, aliases = []] of p.concepts) {
        const [id] = repo.upsertConcept({ name, kind, importance, summary, aliases }, sid);
        run(`UPDATE concepts SET created_at = ? WHERE id = ?`, ago(p.daysAgo).toISOString(), id);
        ids.set(name, id);
      }
      for (const [a, b, type] of p.edges) repo.addEdge(ids.get(a)!, ids.get(b)!, type);

      for (const [concept, kind, prompt, answer, options] of p.cards) {
        const cid = ids.get(concept)!;
        const cardId = repo.addCard(cid, { kind, prompt, answer, options }, ago(p.daysAgo));
        const prof = profiles[concept];
        if (!prof) continue;
        const [since, interval, reps] = prof;
        // replay a plausible history ending `since` days ago at the given interval
        let m = freshMemory(ago(p.daysAgo));
        const step = Math.max(1, (p.daysAgo - since) / reps);
        for (let r = 0; r < reps; r++) {
          const at = ago(p.daysAgo - step * (r + 1));
          m = sm2(m, r === 1 && reps > 3 ? 3 : 4, at);
          repo.logReview(cardId, cid, r === 1 && reps > 3 ? 3 : 4, 'card', at);
        }
        const last = ago(since);
        repo.saveCardMemory({
          ...repo.getCard(cardId)!,
          ...m,
          interval,
          lastReviewAt: last.toISOString(),
          dueAt: new Date(last.getTime() + interval * DAY_MS).toISOString(),
        });
      }

      passages.forEach((text, i) => {
        const lower = text.toLowerCase();
        for (const [name, , , , aliases = []] of p.concepts) {
          if ([name, ...aliases].some((n) => lower.includes(n.toLowerCase()))) repo.addMention(ids.get(name)!, chunkIds[i]);
        }
      });
    }

    for (const [name, summary, reason, between] of gaps) {
      repo.addGap(name, summary, reason, between.map((n) => repo.findConceptByName(n)!.id));
    }
  });
}

if (process.argv[1]?.endsWith('seed.ts')) {
  const reset = process.argv.includes('--reset');
  const existing = repo.listConcepts().length;
  if (existing && !reset) {
    console.log(`The vault already holds ${existing} concepts. Run "npm run seed -- --reset" to replace them with the sample plate.`);
  } else {
    seed(reset);
    console.log(`Sample plate developed: ${repo.listConcepts().length} concepts, ${repo.allCards().length} cards, ${repo.listGaps().length} gaps.`);
  }
}
