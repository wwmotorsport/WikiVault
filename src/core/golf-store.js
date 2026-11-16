'use strict';
// The wiki golf clubhouse: the players saved on this computer, each with a character, and their
// records over time. One small JSON file; nothing here leaves the computer.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const CHARACTERS = ['cap', 'visor', 'bot', 'owl', 'fox', 'astro', 'wizard', 'cat'];
const COLOURS = ['#e4433b', '#f28c28', '#f2d14b', '#3fae5a', '#2f7fe0', '#7b55d6', '#e36bb0', '#f4f4f4'];
const MAX_SAVED = 24;
const KEEP_ROUNDS = 20;

/**
 * A handicap in strokes per nine holes, or null until three rounds have been played.
 * Each round's score over par is scaled to nine holes; the handicap is the average of the better
 * half of the last ten rounds, so one bad day does not move it much. Zero or below shows as scratch.
 */
function handicapOf(rounds) {
  const recent = (rounds || []).filter((r) => r.holes > 0).slice(-10);
  if (recent.length < 3) return null;
  const diffs = recent.map((r) => ((r.strokes - r.par) * 9) / r.holes).sort((a, b) => a - b);
  const best = diffs.slice(0, Math.ceil(diffs.length / 2));
  const avg = best.reduce((n, d) => n + d, 0) / best.length;
  return Math.max(0, Math.min(54, Math.round(avg)));
}

const emptyStats = () => ({ rounds: 0, wins: 0, losses: 0, ties: 0, holes: 0, strokes: 0, par: 0, aces: 0, eagles: 0, birdies: 0, pars: 0, bogeys: 0, worse: 0, pickups: 0, best: null });

function cleanName(raw) { return String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 24); }

class GolfStore {
  constructor(file, { log = () => {} } = {}) {
    this.file = file;
    this.log = log;
    this.data = { version: 1, players: [] };
    this.load();
  }

  load() {
    try {
      const d = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (d && Array.isArray(d.players)) {
        this.data = { version: 1, players: d.players.filter((p) => p && p.id && p.name).map((p) => ({ ...p, stats: { ...emptyStats(), ...(p.stats || {}) }, rounds: Array.isArray(p.rounds) ? p.rounds : [] })) };
      }
    } catch (err) {
      if (err.code !== 'ENOENT') this.log(`golf records could not be read: ${err.message}`);
    }
  }

  async save() {
    const tmp = `${this.file}.tmp`;
    await fsp.mkdir(path.dirname(this.file), { recursive: true });
    await fsp.writeFile(tmp, JSON.stringify(this.data, null, 1));
    await fsp.rename(tmp, this.file);
  }

  get(id) { return this.data.players.find((p) => p.id === id) || null; }

  /** What the clubhouse shows: every saved player with their record and handicap, most recently played first. */
  list() {
    return this.data.players.map((p) => {
      const s = p.stats;
      return {
        id: p.id, name: p.name, character: p.character, colour: p.colour, createdAt: p.createdAt,
        handicap: handicapOf(p.rounds),
        stats: { ...s, perHole: s.holes ? (s.strokes - s.par) / s.holes : null },
        rounds: p.rounds.slice().reverse(),
        lastPlayed: p.rounds.length ? p.rounds[p.rounds.length - 1].at : 0,
      };
    }).sort((a, b) => b.lastPlayed - a.lastPlayed || a.createdAt - b.createdAt);
  }

  /** Add a player, or change the name, character or colour of one. */
  async savePlayer({ id, name, character, colour }, now = Date.now()) {
    const clean = cleanName(name);
    if (!clean) throw new Error('Give the player a name.');
    const clash = this.data.players.find((p) => p.id !== id && p.name.toLowerCase() === clean.toLowerCase());
    if (clash) throw new Error(`There is already a player called ${clash.name}.`);
    const look = { character: CHARACTERS.includes(character) ? character : CHARACTERS[0], colour: COLOURS.includes(colour) ? colour : COLOURS[0] };
    let player = id ? this.get(id) : null;
    if (id && !player) throw new Error('That player is no longer saved.');
    if (!player) {
      if (this.data.players.length >= MAX_SAVED) throw new Error(`The clubhouse holds ${MAX_SAVED} players. Remove one first.`);
      player = { id: crypto.randomBytes(6).toString('hex'), name: clean, ...look, createdAt: now, stats: emptyStats(), rounds: [] };
      this.data.players.push(player);
    } else Object.assign(player, { name: clean, ...look });
    await this.save();
    return player.id;
  }

  async deletePlayer(id) {
    const before = this.data.players.length;
    this.data.players = this.data.players.filter((p) => p.id !== id);
    if (this.data.players.length !== before) await this.save();
    return true;
  }

  /**
   * Add a finished round (GolfGame.result()) to the records of the saved players who took part.
   * Wins and losses are only counted when more than one person played.
   */
  async recordRound(result) {
    if (!result || !result.holes) return;
    const field = result.players.length;
    const winners = result.players.filter((r) => r.place === 1).length;
    for (const r of result.players) {
      const p = r.id ? this.get(r.id) : null;
      if (!p) continue;
      const s = p.stats;
      s.rounds += 1;
      s.holes += result.holes;
      s.strokes += r.strokes;
      s.par += result.par;
      if (field > 1) {
        if (r.place === 1 && winners === 1) s.wins += 1;
        else if (r.place === 1) s.ties += 1;
        else s.losses += 1;
      }
      for (const c of r.cards) {
        const d = c.strokes - c.par;
        if (!c.holed) s.pickups += 1;
        else if (c.strokes === 1) s.aces += 1;
        else if (d <= -2) s.eagles += 1;
        else if (d === -1) s.birdies += 1;
        else if (d === 0) s.pars += 1;
        else if (d === 1) s.bogeys += 1;
        else s.worse += 1;
      }
      const perNine = ((r.strokes - result.par) * 9) / result.holes;
      if (!s.best || perNine < s.best.perNine) s.best = { perNine, toPar: r.strokes - result.par, holes: result.holes, at: result.at };
      p.rounds.push({ at: result.at, library: result.library, holes: result.holes, par: result.par, strokes: r.strokes, net: result.useHandicaps ? r.net : null, place: r.place, field });
      if (p.rounds.length > KEEP_ROUNDS) p.rounds = p.rounds.slice(-KEEP_ROUNDS);
    }
    await this.save();
  }
}

module.exports = { GolfStore, handicapOf, CHARACTERS, COLOURS, MAX_SAVED };
