import DeckStack from "./components/DeckStack";
import GlobalFxRack from "./components/GlobalFxRack";
import TransportBar from "./components/TransportBar";
import useDecks from "./hooks/useDecks";

const App = () => {
  console.info("App: render");
  const {
    decks,
    addDeck,
    removeDeck,
    handleLoadClick,
    handleFileSelected,
    playDeck,
    pauseDeck,
    setFileInputRef,
    setDeckGain,
    seekDeck,
    setDeckZoom,
    setDeckFollow,
    setDeckLoop,
    setDeckLoopBounds,
    setDeckBpmOverride,
    tapTempo,
    setDeckPreservePitch,
    stretchEngineStatus,
    deckStretchStatus,
    getDeckPosition,
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
          onPause={pauseDeck}
          onGainChange={setDeckGain}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onFollowChange={setDeckFollow}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onBpmOverrideChange={setDeckBpmOverride}
          onTapTempo={tapTempo}
          onPreservePitchChange={setDeckPreservePitch}
          stretchEngineStatus={stretchEngineStatus}
          deckStretchStatus={deckStretchStatus}
          getDeckPosition={getDeckPosition}
          setFileInputRef={setFileInputRef}
        />
      </main>

      <TransportBar />
    </div>
  );
};

export default App;
