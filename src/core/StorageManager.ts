import * as fs from "fs/promises";
import * as path from "path";
import { AIInteraction, AnalyticsData, FilterOptions } from "../types";

/**
 * Handles persisting interaction telemetry to disk using a JSON document. The
 * class maintains an in-memory cache so consumers can query data without
 * touching the filesystem for every read, only synchronising to disk when
 * updates occur.
 */
export class StorageManager {
  private storagePath: string;
  private interactions: AIInteraction[];
  private maxInteractions: number;
  private loadPromise: Promise<void>;

  /**
   * Construct a new storage manager instance.
   *
   * @param storageDir - Directory where the interactions JSON should live.
   */
  constructor(storageDir: string) {
    this.storagePath = path.join(storageDir, "interactions.json");
    this.interactions = [];
    this.maxInteractions = 10000;

    // Kick off the initial load immediately and cache the promise so other
    // operations can await completion when necessary. This prevents race
    // conditions where writes occur before the asynchronous load populates the
    // in-memory cache.
    this.loadPromise = this.load();
  }

  /**
   * Ensure the storage file has been read before mutating operations run.
   */
  private async ensureLoaded(): Promise<void> {
    await this.loadPromise;
  }

  /**
   * Load interactions from disk into memory.
   *
   * The method gracefully handles missing files or malformed JSON by logging a
   * message and resetting the in-memory cache rather than throwing exceptions.
   */
  private async load(): Promise<void> {
    try {
      await fs.access(this.storagePath);
    } catch (error) {
      this.interactions = [];
      console.log("No existing storage, starting fresh");
      return;
    }

    try {
      const data = await fs.readFile(this.storagePath, "utf-8");
      const parsed = JSON.parse(data);

      if (Array.isArray(parsed)) {
        this.interactions = parsed as AIInteraction[];
        if (this.interactions.length > this.maxInteractions) {
          // Ensure we never exceed the configured storage cap even if the file
          // was created with a larger size in an earlier session.
          this.interactions = this.interactions.slice(-this.maxInteractions);
        }
      } else {
        this.interactions = [];
        console.error(
          "Storage file malformed: expected an array of interactions"
        );
        return;
      }

      console.log(`Loaded ${this.interactions.length} interactions`);
    } catch (error) {
      // Any read or parse issue should not crash the extension; instead we log
      // the error and reset to a clean slate so future saves succeed.
      this.interactions = [];
      console.error("Failed to load interactions from disk", error);
    }
  }

  /**
   * Persist the current in-memory interactions to disk as JSON.
   */
  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      const data = JSON.stringify(this.interactions, null, 2);
      await fs.writeFile(this.storagePath, data, "utf-8");
    } catch (error) {
      console.error("Failed to save interactions", error);
    }
  }

  /**
   * Add a new interaction to the cache and persist it.
   *
   * @param interaction - Interaction that should be stored.
   */
  public async saveInteraction(interaction: AIInteraction): Promise<void> {
    await this.ensureLoaded();

    console.log("Saving interaction:", {
      id: interaction.id,
      type: interaction.type,
      timestamp: interaction.timestamp,
    });

    this.interactions.push(interaction);

    if (this.interactions.length > this.maxInteractions) {
      this.interactions = this.interactions.slice(-this.maxInteractions);
    }

    await this.save();
  }

  /**
   * Return a shallow copy of all stored interactions to prevent accidental
   * external mutation.
   */
  public getInteractions(): AIInteraction[] {
    console.log("Getting interactions, total count:", this.interactions.length);
    return [...this.interactions];
  }

  /**
   * Filter interactions based on the provided options.
   *
   * @param filter - Constraints to apply when selecting interactions.
   */
  public getInteractionsFiltered(filter: FilterOptions): AIInteraction[] {
    return this.interactions.filter((interaction) => {
      if (filter.startDate && interaction.timestamp < filter.startDate) {
        return false;
      }
      if (filter.endDate && interaction.timestamp > filter.endDate) {
        return false;
      }
      if (filter.language && interaction.language !== filter.language) {
        return false;
      }
      if (filter.modelName && interaction.modelName !== filter.modelName) {
        return false;
      }
      return true;
    });
  }

  /**
   * Generate aggregate analytics from the stored interactions.
   */
  public getAnalytics(): AnalyticsData {
    console.log(
      "Getting analytics, total interactions:",
      this.interactions.length
    );

    const totalInteractions = this.interactions.length;

    const averageLatency =
      totalInteractions === 0
        ? 0
        : Math.round(
            this.interactions.reduce(
              (sum, interaction) => sum + interaction.latency,
              0
            ) / totalInteractions
          );

    const acceptanceRate =
      totalInteractions === 0
        ? 0
        : Math.round(
            (this.interactions.filter((interaction) => interaction.accepted)
              .length /
              totalInteractions) *
              100
          );

    const languageCounts = new Map<string, number>();
    for (const interaction of this.interactions) {
      const existing = languageCounts.get(interaction.language) ?? 0;
      languageCounts.set(interaction.language, existing + 1);
    }

    const topLanguages = Array.from(languageCounts.entries())
      .map(([language, count]) => ({ language, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const sevenDaysAgo = new Date();
    sevenDaysAgo.setHours(0, 0, 0, 0);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);

    const interactionsOverTimeMap = new Map<string, number>();
    for (const interaction of this.interactions) {
      if (interaction.timestamp < sevenDaysAgo.getTime()) {
        continue;
      }

      const date = new Date(interaction.timestamp);
      const key = date.toISOString().slice(0, 10);
      const existing = interactionsOverTimeMap.get(key) ?? 0;
      interactionsOverTimeMap.set(key, existing + 1);
    }

    const interactionsOverTime = Array.from(interactionsOverTimeMap.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    return {
      totalInteractions,
      averageLatency,
      acceptanceRate,
      topLanguages,
      interactionsOverTime,
    };
  }

  /**
   * Export stored interactions to the specified file in either JSON or CSV
   * format.
   *
   * @param filePath - Destination path including file extension.
   */
  public async exportLogs(filePath: string): Promise<void> {
    const ext = path.extname(filePath).toLowerCase();

    try {
      await this.ensureLoaded();
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      if (ext === ".json") {
        const data = JSON.stringify(this.interactions, null, 2);
        await fs.writeFile(filePath, data, "utf-8");
      } else if (ext === ".csv") {
        const header = "ID,Timestamp,Type,Language,Accepted,Latency,Model\n";
        const rows = this.interactions
          .map((interaction) =>
            [
              interaction.id,
              interaction.timestamp,
              interaction.type,
              interaction.language,
              interaction.accepted,
              interaction.latency,
              interaction.modelName,
            ].join(",")
          )
          .join("\n");
        await fs.writeFile(filePath, `${header}${rows}`, "utf-8");
      } else {
        console.warn(`Unsupported export extension: ${ext}`);
      }
    } catch (error) {
      console.error("Failed to export logs", error);
    }
  }

  /**
   * Remove all stored interactions from memory and persist the empty state.
   */
  public async clearLogs(): Promise<void> {
    await this.ensureLoaded();
    this.interactions = [];
    await this.save();
  }

  /**
   * Update the maximum number of interactions retained in storage.
   *
   * @param max - New limit for the in-memory cache and persisted file.
   */
  public setMaxInteractions(max: number): void {
    this.maxInteractions = max;
  }
}
