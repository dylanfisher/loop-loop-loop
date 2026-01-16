import { useRef, useState } from "react";

const App = () => {
  const nextDeckId = useRef(2);
  const [deckIds, setDeckIds] = useState<number[]>([1]);

  const handleAddDeck = () => {
    const id = nextDeckId.current;
    nextDeckId.current += 1;
    setDeckIds((prev) => [...prev, id]);
  };

  const handleRemoveDeck = (id: number) => {
    setDeckIds((prev) => (prev.length > 1 ? prev.filter((deckId) => deckId !== id) : prev));
  };

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">Loop Loop Loop</div>
        <div className="app__status">Audio engine: idle</div>
      </header>

      <main className="app__main">
        <section className="panel fx fx--global">
          <div className="panel__title">Global FX</div>
          <div className="fx__row">
            <div className="fx__unit">Master Filter</div>
            <div className="fx__unit">Echo</div>
            <div className="fx__unit">Reverb</div>
          </div>
        </section>

        <section className="panel deck-stack">
          <div className="panel__title">
            <span>Decks</span>
            <div className="panel__actions">
              <button type="button" onClick={handleAddDeck}>
                Add Deck
              </button>
            </div>
          </div>

          <div className="deck-stack__list">
            {deckIds.map((deckId, index) => (
              <div className="deck" key={deckId}>
                <div className="deck__header">
                  <span className="deck__label">Deck {index + 1}</span>
                  <div className="deck__meta">
                    <span>Ready</span>
                    <button
                      type="button"
                      className="deck__remove"
                      onClick={() => handleRemoveDeck(deckId)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="deck__waveform">Waveform / Spectrum</div>
                <div className="deck__controls">
                  <button type="button">Load</button>
                  <button type="button">Play</button>
                  <button type="button">Loop</button>
                  <button type="button">Slice</button>
                </div>
                <div className="deck__fx">
                  <div className="deck__fx-title">Deck FX</div>
                  <div className="deck__fx-row">
                    <span>Filter</span>
                    <span>Delay</span>
                    <span>Granular</span>
                    <span>Freeze</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="app__transport">
        <div className="transport__block">BPM 120</div>
        <div className="transport__block">SYNC</div>
        <div className="transport__block">REC</div>
      </footer>
    </div>
  );
};

export default App;
