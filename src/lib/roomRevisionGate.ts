export class RoomRevisionGate {
  #observedRevision = -1
  #roomSnapshotRevision = -1
  #indexMapRevision = -1

  reset(): void {
    this.#observedRevision = -1
    this.#roomSnapshotRevision = -1
    this.#indexMapRevision = -1
  }

  observeTerminal(revision: number): void {
    this.#observedRevision = Math.max(this.#observedRevision, revision)
  }

  acceptRoomSnapshot(revision: number): boolean {
    if (!this.#accept(revision, this.#roomSnapshotRevision)) return false
    this.#roomSnapshotRevision = revision
    return true
  }

  acceptIndexMap(revision: number): boolean {
    if (!this.#accept(revision, this.#indexMapRevision)) return false
    this.#indexMapRevision = revision
    return true
  }

  get observedRevision(): number { return this.#observedRevision }

  #accept(revision: number, channelRevision: number): boolean {
    if (!Number.isInteger(revision) || revision < 0) return false
    if (revision < this.#observedRevision || revision <= channelRevision) return false
    this.#observedRevision = revision
    return true
  }
}
