/**
 * Bundled question bank -- the fallback used when Firestore has no `questions`
 * collection (or the fetch fails).  Seed Firestore from this file with
 * `npm run seed`; after that Firestore is the source of truth.
 *
 * CALIBRATION BLOCK (3 items, confidence collected)
 * -------------------------------------------------
 * k=3 is the measured knee: 0->3 buys +17 to +33 accuracy points, 3->7 buys
 * only +1.4 to +2.6 (CONTEXT.md sec.7).  Items must NOT be easy -- easy items
 * were the worst calibration strategy on both quizzes tested.  These three are
 * medium-to-hard syllogism / conditional-logic items where the intuitive answer
 * is wrong often enough to spread the ratings out.
 *
 * TECHNICAL BLOCK (no confidence widget, telemetry only)
 * ------------------------------------------------------
 * Confidence for these is predicted from the calibration block plus behaviour.
 */

export const CALIBRATION_QUESTIONS = [
  {
    id: "cal_1",
    block: "calibration",
    type: "Reasoning",
    difficulty: "medium",
    text:
      "All roses are flowers. Some flowers fade quickly. " +
      "Therefore, some roses fade quickly.",
    prompt: "Is this argument valid or invalid?",
    options: ["Valid", "Invalid"],
    correctAnswer: "Invalid",
    explanation:
      "The flowers that fade quickly need not be roses at all. The conclusion " +
      "may happen to be true, but it does not follow from the premises — and " +
      "validity is about the following, not the truth.",
  },
  {
    id: "cal_2",
    block: "calibration",
    type: "Reasoning",
    difficulty: "hard",
    text:
      "If it rains, the match is cancelled. The match was cancelled. " +
      "Therefore, it rained.",
    prompt: "Is this argument valid or invalid?",
    options: ["Valid", "Invalid"],
    correctAnswer: "Invalid",
    explanation:
      "Affirming the consequent. The match could have been cancelled for any " +
      "number of other reasons; rain is sufficient for cancellation, not " +
      "necessary for it.",
  },
  {
    id: "cal_3",
    block: "calibration",
    type: "Reasoning",
    difficulty: "medium",
    text:
      "No reptiles are warm-blooded. All snakes are reptiles. " +
      "Therefore, no snakes are warm-blooded.",
    prompt: "Is this argument valid or invalid?",
    options: ["Valid", "Invalid"],
    correctAnswer: "Valid",
    explanation:
      "A valid syllogism (Celarent). If the whole class of reptiles is excluded " +
      "from the warm-blooded, and snakes sit inside that class, snakes are " +
      "excluded too.",
  },
];

export const TECHNICAL_QUESTIONS = [
  {
    id: "tech_1",
    block: "technical",
    type: "Theory",
    difficulty: "medium",
    text:
      "A relation R(A, B, C, D) has functional dependencies A → B and C → D. " +
      "What is the highest normal form R is guaranteed to be in?",
    options: ["1NF", "2NF", "3NF", "BCNF"],
    correctAnswer: "1NF",
    explanation:
      "With candidate key AC, both B and D are partially dependent on the key, " +
      "so 2NF is already violated. R only satisfies 1NF.",
  },
  {
    id: "tech_2",
    block: "technical",
    type: "Apply",
    difficulty: "medium",
    text:
      "Which SQL clause is evaluated FIRST when the database executes a query " +
      "containing SELECT, FROM, WHERE, GROUP BY and HAVING?",
    options: ["SELECT", "FROM", "WHERE", "GROUP BY"],
    correctAnswer: "FROM",
    explanation:
      "Logical evaluation order is FROM → WHERE → GROUP BY → HAVING → SELECT → " +
      "ORDER BY. This is why a SELECT alias cannot be used in WHERE.",
  },
  {
    id: "tech_3",
    block: "technical",
    type: "Theory",
    difficulty: "hard",
    text:
      "A schedule is conflict-serializable if and only if its precedence graph:",
    options: [
      "Is acyclic",
      "Is fully connected",
      "Contains exactly one cycle",
      "Is bipartite",
    ],
    correctAnswer: "Is acyclic",
    explanation:
      "A cycle in the precedence graph means no topological order of the " +
      "transactions exists, so no equivalent serial schedule exists either.",
  },
  {
    id: "tech_4",
    block: "technical",
    type: "Apply",
    difficulty: "medium",
    text:
      "A B+ tree of order 4 currently holds 3 keys in its root leaf. " +
      "Inserting a 4th key causes:",
    options: [
      "A split of the leaf node",
      "No structural change",
      "The tree height to drop",
      "A merge with a sibling",
    ],
    correctAnswer: "A split of the leaf node",
    explanation:
      "Order 4 allows at most 3 keys per node. The 4th insertion overflows the " +
      "leaf, which splits and pushes a separator key up into a new root.",
  },
  {
    id: "tech_5",
    block: "technical",
    type: "Theory",
    difficulty: "hard",
    text:
      "Under the READ COMMITTED isolation level, which anomaly can STILL occur?",
    options: [
      "Non-repeatable read",
      "Dirty read",
      "Lost update on a locked row",
      "None of these",
    ],
    correctAnswer: "Non-repeatable read",
    explanation:
      "READ COMMITTED eliminates dirty reads only. Reading the same row twice " +
      "in one transaction can still return different values if another " +
      "transaction commits in between.",
  },
  {
    id: "tech_6",
    block: "technical",
    type: "Apply",
    difficulty: "medium",
    text:
      "Table T has 1,000,000 rows and a column `status` with 3 distinct values. " +
      "A B-tree index on `status` alone will most likely:",
    options: [
      "Be ignored by the planner in favour of a sequential scan",
      "Make every query on T faster",
      "Reduce the table's storage footprint",
      "Guarantee uniqueness of status values",
    ],
    correctAnswer: "Be ignored by the planner in favour of a sequential scan",
    explanation:
      "Very low cardinality means each value matches ~333k rows. Random I/O for " +
      "a third of the table costs more than reading it sequentially.",
  },
  {
    id: "tech_7",
    block: "technical",
    type: "Theory",
    difficulty: "medium",
    text: "In the ACID properties, Durability guarantees that:",
    options: [
      "Committed changes survive a subsequent system crash",
      "Transactions never deadlock",
      "Concurrent transactions do not interfere",
      "Every constraint is checked before commit",
    ],
    correctAnswer: "Committed changes survive a subsequent system crash",
    explanation:
      "Durability is about persistence after commit — normally delivered by a " +
      "write-ahead log flushed before the commit is acknowledged.",
  },
  {
    id: "tech_8",
    block: "technical",
    type: "Apply",
    difficulty: "hard",
    text:
      "Relations R (200 tuples) and S (100 tuples) are joined on a foreign key " +
      "in R referencing the primary key of S, with no nulls. The result has " +
      "exactly:",
    options: ["200 tuples", "100 tuples", "20,000 tuples", "300 tuples"],
    correctAnswer: "200 tuples",
    explanation:
      "Every R tuple matches exactly one S tuple through the foreign key, so " +
      "the join preserves R's cardinality.",
  },
  {
    id: "tech_9",
    block: "technical",
    type: "Theory",
    difficulty: "medium",
    text: "A relation is in BCNF if, for every non-trivial FD X → Y:",
    options: [
      "X is a superkey",
      "Y is a prime attribute",
      "X is a candidate key and Y is not",
      "X and Y are disjoint",
    ],
    correctAnswer: "X is a superkey",
    explanation:
      "BCNF is the strict form: every determinant must be a superkey. 3NF " +
      "relaxes this by also allowing Y to be a prime attribute.",
  },
  {
    id: "tech_10",
    block: "technical",
    type: "Apply",
    difficulty: "hard",
    text:
      "Two-phase locking (2PL) guarantees serializability but does NOT by " +
      "itself prevent:",
    options: ["Deadlock", "Dirty reads", "Lost updates", "Conflict cycles"],
    correctAnswer: "Deadlock",
    explanation:
      "2PL enforces a serializable order, but two transactions each holding a " +
      "lock the other needs will wait forever. Deadlock needs separate " +
      "detection or prevention.",
  },
  {
    id: "tech_11",
    block: "technical",
    type: "Theory",
    difficulty: "medium",
    text:
      "In SQL, `COUNT(column)` differs from `COUNT(*)` in that `COUNT(column)`:",
    options: [
      "Skips rows where the column is NULL",
      "Is always faster",
      "Counts distinct values only",
      "Returns NULL for an empty table",
    ],
    correctAnswer: "Skips rows where the column is NULL",
    explanation:
      "Aggregate functions ignore NULLs. COUNT(*) counts rows regardless; both " +
      "return 0, not NULL, on an empty table.",
  },
  {
    id: "tech_12",
    block: "technical",
    type: "Apply",
    difficulty: "hard",
    text:
      "A query optimiser pushes a selection below a join. This transformation " +
      "is valid because:",
    options: [
      "Selection distributes over join when the predicate uses only one input's attributes",
      "Joins are always commutative",
      "Selections are cheaper than projections",
      "The join result is always smaller than either input",
    ],
    correctAnswer:
      "Selection distributes over join when the predicate uses only one input's attributes",
    explanation:
      "σ_p(R ⋈ S) = σ_p(R) ⋈ S holds only when p references attributes of R " +
      "alone. That restriction is what makes predicate pushdown safe.",
  },
];

export const DEFAULT_CONFIG = {
  title: "Confidence Calibration Quiz",
  subtitle: "Reasoning calibration block, then a technical section",
  totalTimeAllowedMinutes: 25,
  collectCgpa: true,
  shuffleTechnical: false,
};

export const BUNDLED_BANK = {
  calibration: CALIBRATION_QUESTIONS,
  technical: TECHNICAL_QUESTIONS,
  config: DEFAULT_CONFIG,
};
