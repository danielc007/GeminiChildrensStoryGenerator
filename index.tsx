/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality } from "@google/genai";
import './index.css';

type StoryScene = {
    text: string;
    isPlayingAudio: boolean;
    imageUrl?: string;
    isGeneratingImage: boolean;
};

const CharacterInput = ({ id, label, placeholder, value, onChange }) => (
    <div className="input-group">
        <label htmlFor={id}>{label}</label>
        <input type="text" id={id} name={id} placeholder={placeholder} aria-label={label} value={value} onChange={onChange} />
    </div>
);

const App = () => {
  const [characters, setCharacters] = useState([
    { name: '', desc: '', namePlaceholder: 'e.g., Barnaby the Bear', descPlaceholder: 'A clumsy but kind bear who loves honey' },
    { name: '', desc: '', namePlaceholder: 'e.g., Squeaky the Mouse', descPlaceholder: 'A brave little mouse who is scared of cats' }
  ]);
  const [storyScenes, setStoryScenes] = useState<StoryScene[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false);

  const handleInputChange = (index, field, value) => {
    const newCharacters = [...characters];
    newCharacters[index][field] = value;
    setCharacters(newCharacters);
  };

  const togglePanel = () => {
    setIsPanelCollapsed(prev => !prev);
  };

  const generateStory = async () => {
    setLoading(true);
    setIsPanelCollapsed(true);
    setStoryScenes([]);
    setError('');

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        const prompt = `Generate a children story, based on the name and description of the two characters described below. There should be 3 scenes, written in 3 paragraphs.

        Character 1:
        Name: ${characters[0].name || characters[0].namePlaceholder}
        Description: ${characters[0].desc || characters[0].descPlaceholder}

        Character 2:
        Name: ${characters[1].name || characters[1].namePlaceholder}
        Description: ${characters[1].desc || characters[1].descPlaceholder}
        `;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
        });

        const storyText = response.text;
        const paragraphs = storyText.split('\n').filter(p => p.trim() !== '');

        const scenes = paragraphs.map(p => ({
            text: p,
            isPlayingAudio: false,
            imageUrl: undefined,
            isGeneratingImage: false,
        }));
        setStoryScenes(scenes);

    } catch (err) {
        console.error(err);
        setError('Something went wrong while generating the story. Please try again.');
    } finally {
        setLoading(false);
    }
  };

  const handlePlayAudio = async (sceneIndex: number) => {
    setStoryScenes(prev => prev.map((scene, i) => i === sceneIndex ? { ...scene, isPlayingAudio: true } : scene));
    setError('');

    const scene = storyScenes[sceneIndex];
    const firstSentence = scene.text.split(/[.!?]/)[0].trim();
    const textToRead = firstSentence ? firstSentence + '.' : scene.text;

    try {
        const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
        const voiceId = '21m00Tcm4TlvDq8ikWAM'; // Rachel

        if (!elevenLabsApiKey) {
            throw new Error("ElevenLabs API key is not configured.");
        }

        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Accept': 'audio/mpeg',
                'Content-Type': 'application/json',
                'xi-api-key': elevenLabsApiKey,
            },
            body: JSON.stringify({
                text: textToRead,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                }
            }),
        });

        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`Failed to fetch audio from ElevenLabs. Status: ${response.status}. Details: ${errorDetails}`);
        }

        const audioBlob = await response.blob();
        const audioUrl = URL.createObjectURL(audioBlob);
        const audio = new Audio(audioUrl);
        audio.play();
        audio.onended = () => {
            setStoryScenes(prev => prev.map((s, i) => i === sceneIndex ? { ...s, isPlayingAudio: false } : s));
        };
        audio.onerror = () => {
            throw new Error("Error playing audio.");
        }
    } catch (err) {
        console.error('Error with ElevenLabs API:', err.message || err);
        setError('Could not play audio. Check console for details.');
        setStoryScenes(prev => prev.map((s, i) => i === sceneIndex ? { ...s, isPlayingAudio: false } : s));
    }
  };

  const handleGenerateImage = async (sceneIndex: number) => {
    setStoryScenes(prev => prev.map((scene, i) => i === sceneIndex ? { ...scene, isGeneratingImage: true } : scene));
    setError('');

    const scene = storyScenes[sceneIndex];
    const characterDescriptions = characters
        .filter(c => c.name || c.desc)
        .map(c => `${c.name || c.namePlaceholder} (${c.desc || c.descPlaceholder})`)
        .join(', ');

    const basePrompt = `A whimsical, colorful children's storybook illustration in a cute cartoon style. The characters are: ${characterDescriptions}. The scene depicts: ${scene.text}`;

    try {
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        let imageUrl: string | undefined;

        if (sceneIndex === 0) {
            // Generate the first image from text
            const response = await ai.models.generateImages({
                model: 'imagen-4.0-generate-001',
                prompt: basePrompt,
                config: {
                    numberOfImages: 1,
                    outputMimeType: 'image/png',
                    aspectRatio: '16:9',
                },
            });

            const base64ImageBytes: string = response.generatedImages[0].image.imageBytes;
            imageUrl = `data:image/png;base64,${base64ImageBytes}`;
        } else {
            // Generate subsequent images based on previous ones for consistency
            const base64FromDataUrl = (dataUrl: string) => dataUrl.split(',')[1];
            
            const parts: any[] = [{ text: basePrompt }];

            // Add previous image(s) as input
            const image1Url = storyScenes[0]?.imageUrl;
            if (image1Url) {
                parts.unshift({
                    inlineData: {
                        data: base64FromDataUrl(image1Url),
                        mimeType: 'image/png',
                    },
                });
            }

            if (sceneIndex === 2) {
                const image2Url = storyScenes[1]?.imageUrl;
                if (image2Url) {
                    parts.splice(1, 0, { // Insert at index 1, after image 1
                        inlineData: {
                            data: base64FromDataUrl(image2Url),
                            mimeType: 'image/png',
                        },
                    });
                }
            }
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: { parts },
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                },
            });
            
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    const base64ImageBytes: string = part.inlineData.data;
                    imageUrl = `data:image/png;base64,${base64ImageBytes}`;
                    break; // Found the image, exit loop
                }
            }
            if (!imageUrl) {
                throw new Error("Model did not return an image.");
            }
        }
        
        setStoryScenes(prev => prev.map((s, i) => 
            i === sceneIndex ? { ...s, imageUrl: imageUrl, isGeneratingImage: false } : s
        ));
    } catch (err) {
        console.error('Error generating image:', err);
        setError('Could not generate the image. Please try again.');
        setStoryScenes(prev => prev.map((s, i) => 
            i === sceneIndex ? { ...s, isGeneratingImage: false } : s
        ));
    }
  };

  return (
    <main className="app-container" role="main">
      <header>
        <h1>Children's Story Generator</h1>
      </header>
      <section className="character-creation-panel" aria-labelledby="characters-heading">
        <div className="panel-header" onClick={togglePanel}>
            <h2 id="characters-heading">Create Your Characters</h2>
            <button
                className="toggle-panel-btn"
                aria-expanded={!isPanelCollapsed}
                aria-controls="characters-section-wrapper"
            >
                <svg className={`toggle-icon ${isPanelCollapsed ? 'collapsed' : ''}`} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 9L12 15L18 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
            </button>
        </div>
        <div
            id="characters-section-wrapper"
            className={`characters-section-wrapper ${isPanelCollapsed ? '' : 'expanded'}`}
        >
            <div className="characters-section">
                <p className="default-note">Leave blank to accept defaults.</p>
                {characters.map((char, index) => (
                    <div className="character-pair" key={index}>
                        <CharacterInput 
                            id={`name${index + 1}`} 
                            label={`Character ${index + 1} Name`} 
                            placeholder={char.namePlaceholder}
                            value={char.name}
                            onChange={(e) => handleInputChange(index, 'name', e.target.value)}
                        />
                        <CharacterInput 
                            id={`desc${index + 1}`} 
                            label={`Character ${index + 1} Description`} 
                            placeholder={char.descPlaceholder}
                            value={char.desc}
                            onChange={(e) => handleInputChange(index, 'desc', e.target.value)}
                        />
                    </div>
                ))}
            </div>
        </div>
      </section>
      <button className="generate-btn" onClick={generateStory} disabled={loading}>
        {loading ? 'Generating...' : 'Generate Story'}
      </button>

      {loading && <div className="loader" role="status" aria-label="Loading story"></div>}
      {error && <p className="error-message">{error}</p>}
      
      {storyScenes.length > 0 && (
        <section className="story-panel" aria-labelledby="story-heading">
            <h2 id="story-heading">Your Magical Story</h2>
            {storyScenes.map((scene, index) => (
                <div className="story-scene" key={index}>
                    {scene.imageUrl && <img src={scene.imageUrl} alt={`Illustration for scene ${index + 1}`} className="story-image" />}
                    <div className="scene-main">
                        <p className="story-content">{scene.text}</p>
                        <div className="scene-actions">
                            <button 
                                className="play-btn" 
                                onClick={() => handlePlayAudio(index)}
                                disabled={scene.isPlayingAudio}
                                aria-label={`Play audio for scene ${index + 1}`}
                            >
                                {scene.isPlayingAudio ? (
                                    <div className="loader small-loader audio-loader"></div>
                                ) : (
                                <svg className="play-icon" viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M8 5.14v14l11-7-11-7z"></path>
                                    </svg>
                                )}
                            </button>
                            {!scene.imageUrl && (
                                <button 
                                    className="generate-image-btn" 
                                    onClick={() => handleGenerateImage(index)}
                                    disabled={
                                        scene.isGeneratingImage ||
                                        (index === 1 && !storyScenes[0]?.imageUrl) ||
                                        (index === 2 && !storyScenes[1]?.imageUrl)
                                    }
                                    aria-label={`Generate image for scene ${index + 1}`}
                                >
                                    {scene.isGeneratingImage ? (
                                        <div className="loader small-loader audio-loader"></div>
                                    ) : (
                                        <svg className="generate-image-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                                            <circle cx="8.5" cy="8.5" r="1.5"></circle>
                                            <polyline points="21 15 16 10 5 21"></polyline>
                                        </svg>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </section>
      )}
    </main>
  );
};

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<App />);
}