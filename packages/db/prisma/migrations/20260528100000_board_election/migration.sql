-- §10 / §14 board-member election: an INSTRUCTIVE internal proposal whose 5 actors are the
-- candidates and whose delivery_date is the installation date. When approved + the installation
-- date hits, the platform replaces the board seats with the elected candidates.
ALTER TABLE "proposal" ADD COLUMN "is_board_election" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "proposal" ADD COLUMN "board_installed_at" TIMESTAMPTZ;
