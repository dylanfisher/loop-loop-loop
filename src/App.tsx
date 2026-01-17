import DeckStack from "./components/DeckStack";
import GlobalFxRack from "./components/GlobalFxRack";
import TransportBar from "./components/TransportBar";
import useDecks from "./hooks/useDecks";

const App = () => {
  const {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    stopDeck,
    setFileInputRef,
    setDeckGain,
  } = useDecks();

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">Loop Loop Loop</div>
        <div className="app__status">Audio engine: idle</div>
      </header>

      <main className="app__main">
        <GlobalFxRack />
        <DeckStack
          decks={decks}
          onAddDeck={addDeck}
          onRemoveDeck={removeDeck}
          onLoadClick={handleLoadClick}
          onFileSelected={handleFileSelected}
          onPlay={playDeck}
          onStop={stopDeck}
          onGainChange={setDeckGain}
          setFileInputRef={setFileInputRef}
        />
      </main>

      <TransportBar />
    </div>
  );
};

export default App;
