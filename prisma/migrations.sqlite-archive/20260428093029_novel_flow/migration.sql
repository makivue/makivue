-- AlterTable
ALTER TABLE "Episode" ADD COLUMN "chapterContent" TEXT;
ALTER TABLE "Episode" ADD COLUMN "finalizedAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "genre" TEXT,
    "totalEpisodes" INTEGER NOT NULL DEFAULT 1,
    "novel" TEXT,
    "novelSetup" TEXT,
    "novelStage" TEXT NOT NULL DEFAULT 'setup',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "deletedAt" DATETIME
);
INSERT INTO "new_Project" ("createdAt", "deletedAt", "description", "genre", "id", "novel", "status", "title", "totalEpisodes", "updatedAt") SELECT "createdAt", "deletedAt", "description", "genre", "id", "novel", "status", "title", "totalEpisodes", "updatedAt" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
