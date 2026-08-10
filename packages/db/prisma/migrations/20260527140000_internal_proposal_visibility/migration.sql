-- §10 internal proposals: PUBLIC by default, or PRIVATE (visible/votable to board members only).
ALTER TABLE "proposal" ADD COLUMN "is_private" BOOLEAN NOT NULL DEFAULT false;
