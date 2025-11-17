import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";

// --- Helper Functions ---
function decode(base64) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
};

const TeamPanel = ({ teamName, onTeamNameChange, score, onScoreChange, label, ai }) => {
    const [locationInfo, setLocationInfo] = useState<{uri: string; title: string} | null>(null);
    const [isFetchingLocation, setIsFetchingLocation] = useState(false);
    const debounceTimeoutRef = useRef(null);

    const fetchLocation = async (name) => {
        if (!ai) return;

        setIsFetchingLocation(true);
        setLocationInfo(null);

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: `Busca la ubicación del pabellón o campo donde juega habitualmente el club de balonmano "${name}" en España.`,
                config: {
                    tools: [{googleMaps: {}}],
                },
            });

            const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
            const mapsChunk = chunks?.find(chunk => chunk.maps);

            if (mapsChunk && mapsChunk.maps.uri) {
                setLocationInfo({ uri: mapsChunk.maps.uri, title: mapsChunk.maps.title || name });
            } else {
                setLocationInfo(null);
            }
        } catch (error) {
            console.error("Error fetching location:", error);
            setLocationInfo(null);
        } finally {
            setIsFetchingLocation(false);
        }
    };

    useEffect(() => {
        if (debounceTimeoutRef.current) {
            clearTimeout(debounceTimeoutRef.current);
        }
        
        const lowerCaseTeamName = teamName.trim().toLowerCase();
        if (teamName && teamName.trim().length > 2 && lowerCaseTeamName !== 'home' && lowerCaseTeamName !== 'away') {
            debounceTimeoutRef.current = setTimeout(() => {
                fetchLocation(teamName);
            }, 800);
        } else {
            setLocationInfo(null);
        }

        return () => {
            if (debounceTimeoutRef.current) {
                clearTimeout(debounceTimeoutRef.current);
            }
        };
    }, [teamName, ai]);

    return (
        <div className="team">
            <input 
                type="text" 
                value={teamName} 
                onChange={(e) => onTeamNameChange(e.target.value)}
                className="team-name"
                aria-label={label}
            />
            <div className="location-info">
                {isFetchingLocation && <span>Buscando ubicación...</span>}
                {locationInfo && !isFetchingLocation && (
                    <a href={locationInfo.uri} target="_blank" rel="noopener noreferrer">
                        📍 {locationInfo.title}
                    </a>
                )}
            </div>
            <div className="score">{score}</div>
            <div className="score-controls">
                <button onClick={() => onScoreChange(-1)} aria-label={`Quitar gol a ${teamName}`}>-</button>
                <button onClick={() => onScoreChange(1)} aria-label={`Añadir gol a ${teamName}`}>+</button>
            </div>
        </div>
    );
};


const App = () => {
    const [localName, setLocalName] = useState('Home');
    const [visitanteName, setVisitanteName] = useState('Away');
    const [localScore, setLocalScore] = useState(0);
    const [visitanteScore, setVisitanteScore] = useState(0);
   
    const [initialTime, setInitialTime] = useState(30 * 60); // 30 minutes
    const [time, setTime] = useState(initialTime);
    const [isActive, setIsActive] = useState(false);
    const [period, setPeriod] = useState(1);
    
    const [isGeneratingSpeech, setIsGeneratingSpeech] = useState(false);
    const [matchHistory, setMatchHistory] = useState([]);
    const [isHistoryVisible, setIsHistoryVisible] = useState(false);
    const [showResetConfirm, setShowResetConfirm] = useState(false);
    const [showPeriodConfirm, setShowPeriodConfirm] = useState(false);
    const [periodChangeDelta, setPeriodChangeDelta] = useState(0);


    const timerRef = useRef(null);
    const audioContextRef = useRef(null);
    const aiRef = useRef(null);
    
    // Initialize & Load from localStorage
    useEffect(() => {
        aiRef.current = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        
        try {
            const savedStateJSON = localStorage.getItem('handballScoreboardState');
            if (savedStateJSON) {
                const savedState = JSON.parse(savedStateJSON);
                setLocalName(savedState.localName || 'Home');
                setVisitanteName(savedState.visitanteName || 'Away');
                setLocalScore(savedState.localScore || 0);
                setVisitanteScore(savedState.visitanteScore || 0);
                setPeriod(savedState.period || 1);
                setInitialTime(savedState.initialTime || 30 * 60);
                setTime(savedState.time !== undefined ? savedState.time : (savedState.initialTime || 30 * 60));
            }
            const savedHistoryJSON = localStorage.getItem('handballMatchHistory');
            if(savedHistoryJSON) {
                setMatchHistory(JSON.parse(savedHistoryJSON));
            }
        } catch (error) {
            console.error("Failed to load state from localStorage", error);
        }
    }, []);

    // Save state to localStorage
    useEffect(() => {
        const stateToSave = {
            localName,
            visitanteName,
            localScore,
            visitanteScore,
            period,
            time,
            initialTime,
        };
        try {
            localStorage.setItem('handballScoreboardState', JSON.stringify(stateToSave));
        } catch (error) {
            console.error("Failed to save state to localStorage", error);
        }
    }, [localName, visitanteName, localScore, visitanteScore, period, time, initialTime]);

    // Save history to localStorage
    useEffect(() => {
        try {
            localStorage.setItem('handballMatchHistory', JSON.stringify(matchHistory));
        } catch (error) {
            console.error("Failed to save history to localStorage", error);
        }
    }, [matchHistory]);
    
    const playSiren = () => {
        const context = audioContextRef.current;
        if (!context) return;

        let sirenCount = 0;
        const sirenInterval = setInterval(() => {
            if (sirenCount >= 3) {
                clearInterval(sirenInterval);
                return;
            }
            const oscillator = context.createOscillator();
            const gain = context.createGain();
            oscillator.connect(gain);
            gain.connect(context.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(900, context.currentTime);
            oscillator.frequency.linearRampToValueAtTime(600, context.currentTime + 0.5);
            oscillator.start(context.currentTime);
            oscillator.stop(context.currentTime + 0.5);
            sirenCount++;
        }, 600);
    };

    // Timer Effect
    useEffect(() => {
        if (isActive && time > 0) {
            timerRef.current = setInterval(() => {
                setTime((prevTime) => prevTime - 1);
            }, 1000);
        } else if (time <= 0 && isActive) {
            setIsActive(false);
            playSiren();
            setTime(0);
        }
        
        return () => clearInterval(timerRef.current);
    }, [isActive, time]);

    const speakScore = async (newLocalScore, newVisitanteScore) => {
        if (isGeneratingSpeech || !aiRef.current || !audioContextRef.current) return;
        setIsGeneratingSpeech(true);

        const prompt = `Di en castellano: ${localName} ${newLocalScore}, ${visitanteName} ${newVisitanteScore}`;
        
        try {
            const response = await aiRef.current.models.generateContent({
                model: "gemini-2.5-flash-preview-tts",
                contents: [{ parts: [{ text: prompt }] }],
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: 'Kore' },
                        },
                    },
                },
            });

            const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                const audioBuffer = await decodeAudioData(
                    decode(base64Audio),
                    audioContextRef.current,
                    24000, // sample rate for this model
                    1, // number of channels
                );
                const source = audioContextRef.current.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(audioContextRef.current.destination);
                source.start();
            }
        } catch (error) {
            console.error("Error al generar el audio:", error);
        } finally {
            setIsGeneratingSpeech(false);
        }
    };
    
    const handleScoreChange = (team, delta) => {
        if (team === 'local') {
            const newScore = Math.max(0, localScore + delta);
            setLocalScore(newScore);
            speakScore(newScore, visitanteScore);
        } else {
            const newScore = Math.max(0, visitanteScore + delta);
            setVisitanteScore(newScore);
            speakScore(localScore, newScore);
        }
    };
    
    const handleStart = () => {
        if (time > 0) {
            setIsActive(true);
        }
    };
    
    const handlePause = () => {
        setIsActive(false);
    };
    
    const handleReset = () => {
        setShowResetConfirm(true);
    };

    const confirmReset = () => {
        setIsActive(false);
        setTime(initialTime);
        setLocalScore(0);
        setVisitanteScore(0);
        setPeriod(1);
        setShowResetConfirm(false);
    };
    
    const handlePeriodChange = (delta) => {
        setPeriodChangeDelta(delta);
        setShowPeriodConfirm(true);
    };

    const confirmPeriodChange = () => {
        setPeriod((prevPeriod) => Math.max(1, prevPeriod + periodChangeDelta));
        setTime(initialTime);
        setIsActive(false);
        setShowPeriodConfirm(false);
        setPeriodChangeDelta(0);
    };

    const handleInitialTimeChange = (delta) => {
        if (isActive) return;
        const newInitialTime = Math.max(60, initialTime + delta * 60); // min 1 minute
        setInitialTime(newInitialTime);
        setTime(newInitialTime);
    };

    const handleSaveMatch = () => {
        const newMatch = {
            id: Date.now(),
            localName,
            visitanteName,
            localScore,
            visitanteScore,
            period,
            time,
            date: new Date().toLocaleString('es-ES'),
        };
        setMatchHistory(prev => [newMatch, ...prev]);
    };

    const handleClearHistory = () => {
        if(window.confirm('¿Estás seguro de que quieres borrar todo el historial?')) {
            setMatchHistory([]);
        }
    };

    return (
        <div className="container">
            <h1>MARCADOR</h1>
            <div className="scoreboard">
                <TeamPanel
                    teamName={localName}
                    onTeamNameChange={setLocalName}
                    score={localScore}
                    onScoreChange={(delta) => handleScoreChange('local', delta)}
                    label="Nombre del equipo local"
                    ai={aiRef.current}
                />
                <TeamPanel
                    teamName={visitanteName}
                    onTeamNameChange={setVisitanteName}
                    score={visitanteScore}
                    onScoreChange={(delta) => handleScoreChange('visitante', delta)}
                    label="Nombre del equipo visitante"
                    ai={aiRef.current}
                />
            </div>
            <div className="loading-speech">
                {isGeneratingSpeech && 'Anunciando marcador...'}
            </div>

            <div className="timer-container">
                <div className="main-timer-area">
                    <div className="period-controls">
                        <button onClick={() => handlePeriodChange(-1)} aria-label="Periodo anterior">-</button>
                        <div className="period-display">PERIODO<br/><span>{period}</span></div>
                        <button onClick={() => handlePeriodChange(1)} aria-label="Siguiente periodo">+</button>
                    </div>
                    <div className="timer-display-wrapper">
                         <button className="time-adjust-btn" onClick={() => handleInitialTimeChange(-1)} disabled={isActive} aria-label="Disminuir tiempo inicial">-</button>
                        <div className="timer-display" aria-live="polite">{formatTime(time)}</div>
                         <button className="time-adjust-btn" onClick={() => handleInitialTimeChange(1)} disabled={isActive} aria-label="Aumentar tiempo inicial">+</button>
                    </div>
                </div>

                <div className="timer-controls">
                    {!isActive && time > 0 ? (
                        <button onClick={handleStart} className="btn-start">Iniciar</button>
                    ) : (
                        <button onClick={handlePause} className="btn-pause">Pausar</button>
                    )}
                    <button onClick={handleReset} className="btn-reset">Reiniciar</button>
                </div>
            </div>

            <div className="match-actions">
                <button onClick={handleSaveMatch}>Guardar Partido</button>
                <button onClick={() => setIsHistoryVisible(p => !p)}>
                    {isHistoryVisible ? 'Ocultar Historial' : 'Ver Historial'}
                </button>
            </div>

            {isHistoryVisible && (
                <div className="history-container">
                    <h2>Historial de Partidos</h2>
                    {matchHistory.length > 0 ? (
                        <>
                            <button onClick={handleClearHistory} className="btn-clear-history">
                                Limpiar Historial
                            </button>
                            <ul className="history-list">
                                {matchHistory.map((match) => (
                                    <li key={match.id} className="history-item">
                                        <div className="history-details">
                                            <span className="history-date">{match.date}</span>
                                            <span className="history-score">
                                                {match.localName} <strong>{match.localScore}</strong> - <strong>{match.visitanteScore}</strong> {match.visitanteName}
                                            </span>
                                            <span className="history-period">
                                                (Periodo: {match.period}, Tiempo Restante: {formatTime(match.time)})
                                            </span>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        </>
                    ) : (
                        <p>No hay partidos guardados.</p>
                    )}
                </div>
            )}

            {showResetConfirm && (
                <div className="modal-overlay" onClick={() => setShowResetConfirm(false)}>
                    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="reset-dialog-title" onClick={(e) => e.stopPropagation()}>
                        <h2 id="reset-dialog-title" className="sr-only">Confirmar reinicio</h2>
                        <p>¿Estás seguro de que quieres reiniciar el partido? Se perderán los marcadores y el tiempo.</p>
                        <div className="modal-actions">
                            <button onClick={() => setShowResetConfirm(false)} className="btn-reset">Cancelar</button>
                            <button onClick={confirmReset} className="btn-pause">Sí, reiniciar</button>
                        </div>
                    </div>
                </div>
            )}

            {showPeriodConfirm && (
                <div className="modal-overlay" onClick={() => setShowPeriodConfirm(false)}>
                    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="period-dialog-title" onClick={(e) => e.stopPropagation()}>
                        <h2 id="period-dialog-title" className="sr-only">Confirmar cambio de periodo</h2>
                        <p>¿Estás seguro de que quieres cambiar de periodo? El tiempo se reiniciará.</p>
                        <div className="modal-actions">
                            <button onClick={() => setShowPeriodConfirm(false)} className="btn-reset">Cancelar</button>
                            <button onClick={confirmPeriodChange} className="btn-pause">Sí, cambiar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);