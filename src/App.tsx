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
    setDeckFilter,
    setDeckResonance,
    setDeckEqLow,
    setDeckEqMid,
    setDeckEqHigh,
    seekDeck,
    setDeckZoom,
    setDeckFollow,
    setDeckLoop,
    setDeckLoopBounds,
    setDeckBpmOverride,
    tapTempo,
    automationState,
    startAutomationRecording,
    stopAutomationRecording,
    updateAutomationValue,
    getAutomationPlayhead,
    toggleAutomationActive,
    resetAutomationTrack,
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
          onFilterChange={setDeckFilter}
          onResonanceChange={setDeckResonance}
          onEqLowChange={setDeckEqLow}
          onEqMidChange={setDeckEqMid}
          onEqHighChange={setDeckEqHigh}
          onSeek={seekDeck}
          onZoomChange={setDeckZoom}
          onFollowChange={setDeckFollow}
          onLoopChange={setDeckLoop}
          onLoopBoundsChange={setDeckLoopBounds}
          onBpmOverrideChange={setDeckBpmOverride}
          onTapTempo={tapTempo}
          automationState={automationState}
          onAutomationStart={startAutomationRecording}
          onAutomationStop={stopAutomationRecording}
          onAutomationValueChange={updateAutomationValue}
          getAutomationPlayhead={getAutomationPlayhead}
          onAutomationToggle={toggleAutomationActive}
          onAutomationReset={resetAutomationTrack}
          getDeckPosition={getDeckPosition}
          setFileInputRef={setFileInputRef}
        />
      </main>

      <TransportBar />
    </div>
  );
};

export default App;
