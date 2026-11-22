/** Poker hand rankings, strongest first, for players who are new to the game. */

type Card = [rank: string, suit: '♠' | '♥' | '♦' | '♣'];

interface HandRank {
  name: string;
  what: string;
  cards: Card[];
  /** How many of the example cards (from the left) actually make the hand. */
  made: number;
}

const HANDS: HandRank[] = [
  { name: 'Royal flush', what: 'A, K, Q, J, 10, all the same suit.', cards: [['A', '♠'], ['K', '♠'], ['Q', '♠'], ['J', '♠'], ['10', '♠']], made: 5 },
  { name: 'Straight flush', what: 'Five cards in a row, all the same suit.', cards: [['9', '♥'], ['8', '♥'], ['7', '♥'], ['6', '♥'], ['5', '♥']], made: 5 },
  { name: 'Four of a kind', what: 'Four cards of the same rank.', cards: [['Q', '♠'], ['Q', '♥'], ['Q', '♦'], ['Q', '♣'], ['4', '♠']], made: 4 },
  { name: 'Full house', what: 'Three of one rank plus a pair of another.', cards: [['K', '♠'], ['K', '♥'], ['K', '♦'], ['7', '♣'], ['7', '♠']], made: 5 },
  { name: 'Flush', what: 'Five cards of the same suit, in any order.', cards: [['A', '♦'], ['J', '♦'], ['8', '♦'], ['6', '♦'], ['2', '♦']], made: 5 },
  { name: 'Straight', what: 'Five cards in a row, in mixed suits.', cards: [['8', '♠'], ['7', '♦'], ['6', '♣'], ['5', '♥'], ['4', '♠']], made: 5 },
  { name: 'Three of a kind', what: 'Three cards of the same rank.', cards: [['9', '♠'], ['9', '♥'], ['9', '♦'], ['K', '♣'], ['3', '♠']], made: 3 },
  { name: 'Two pair', what: 'Two different pairs.', cards: [['J', '♠'], ['J', '♦'], ['5', '♥'], ['5', '♣'], ['A', '♠']], made: 4 },
  { name: 'Pair', what: 'Two cards of the same rank.', cards: [['10', '♠'], ['10', '♥'], ['K', '♦'], ['7', '♣'], ['2', '♠']], made: 2 },
  { name: 'High card', what: 'None of the above. Your highest card plays.', cards: [['A', '♠'], ['J', '♦'], ['8', '♣'], ['6', '♥'], ['3', '♠']], made: 1 },
];

function MiniCard({ card, dim }: { card: Card; dim: boolean }) {
  const red = card[1] === '♥' || card[1] === '♦';
  return (
    <span className={`mini-card ${red ? 'red' : ''} ${dim ? 'dim' : ''}`}>
      <b>{card[0]}</b>
      {/* U+FE0E keeps the suit as a plain symbol instead of an emoji on iOS. */}
      <span>{card[1] + '︎'}</span>
    </span>
  );
}

export function HandGuide({ onClose }: { onClose: () => void }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Poker hand rankings">
        <div className="sheet-head">
          <h2>Poker hands</h2>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="muted small">Strongest at the top. Each hand beats every hand below it.</p>
        <ol className="hands">
          {HANDS.map((h, i) => (
            <li key={h.name}>
              <span className="hand-no">{i + 1}</span>
              <div className="hand-body">
                <div className="hand-name">{h.name}</div>
                <div className="hand-cards" aria-hidden="true">
                  {h.cards.map((c, k) => (
                    <MiniCard key={k} card={c} dim={k >= h.made} />
                  ))}
                </div>
                <div className="muted small">{h.what}</div>
              </div>
            </li>
          ))}
        </ol>
        <h3>Good to know</h3>
        <ul className="tips">
          <li>You make the best five-card hand from your two cards and the five on the table.</li>
          <li>Faded cards in the examples are spares (kickers). They only matter to break a tie.</li>
          <li>Same type of hand? The higher cards win: a pair of kings beats a pair of tens.</li>
          <li>An ace can be high (A-K-Q-J-10) or low (5-4-3-2-A) in a straight.</li>
          <li>Exactly equal hands split the pot. Suits are never ranked against each other.</li>
        </ul>
      </div>
    </div>
  );
}

/** The round "i" button that opens the guide. */
export function InfoButton({ onClick }: { onClick: () => void }) {
  return (
    <button className="info-btn" aria-label="Poker hand rankings" onClick={onClick}>
      i
    </button>
  );
}
