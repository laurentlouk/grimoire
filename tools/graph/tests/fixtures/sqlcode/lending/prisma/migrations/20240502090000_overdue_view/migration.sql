-- CreateView (written by hand: the migration tool does not create views)
CREATE VIEW "OverdueLoan" AS SELECT "id", "dueOn" FROM "Loan" WHERE "dueOn" < CURRENT_TIMESTAMP;
