/**
 * How much was written today, counted honestly.
 *
 * A session count is easy to get wrong in a way that flatters: counting the
 * words in the open document makes opening chapter forty look like a productive
 * morning. What a writer means is *net new words since I sat down*, across
 * every document they touched.
 *
 * So the first time a document is seen in a session its length is recorded as a
 * baseline, and the session total is the sum of the differences. Deleting a
 * paragraph reduces the total, because it did. Reopening the same document does
 * not double-count it, because the baseline is per path and taken once.
 *
 * The total can go negative, and it is shown that way. A morning spent cutting
 * is work, and a counter that refuses to admit the cut is a counter nobody
 * should trust.
 */
export class SessionWords {
  private readonly baseline = new Map<string, number>();
  private readonly current = new Map<string, number>();

  /** Record where a document started. Ignored if this session has seen it. */
  begin(path: string, words: number): void {
    if (!this.baseline.has(path)) this.baseline.set(path, words);
    this.current.set(path, words);
  }

  /** Update the live count for a document already begun. */
  update(path: string, words: number): void {
    if (!this.baseline.has(path)) this.baseline.set(path, words);
    this.current.set(path, words);
  }

  /** Net words written this session, across every document touched. */
  get total(): number {
    let sum = 0;
    for (const [path, now] of this.current) sum += now - (this.baseline.get(path) ?? now);
    return sum;
  }

  /** Start a new session — a new project opened, or the writer asked. */
  reset(): void {
    this.baseline.clear();
    this.current.clear();
  }
}
