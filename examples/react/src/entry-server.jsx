import React from 'react';
import { renderToString } from 'react-dom/server';
import App from './App.jsx';
import WeatherService from './services/WeatherService.js';

/**
 * Renders the page on the server, with the weather already in it.
 *
 * The upstream app fetches in an effect, which never runs during a server render, so a page
 * rendered as it stands would be an empty shell and this whole example would demonstrate nothing:
 * there would be no render to save. So the data is fetched here and handed to the tree, which is
 * also what makes a render cost something worth caching.
 */
export async function render(city = 'London') {
  const service = new WeatherService();
  let initialData = null;
  let initialError = null;
  try {
    initialData = await service.getWeatherByCity(city);
  } catch (error) {
    initialError = error.message;
  }

  const html = renderToString(<App initialData={initialData} initialError={initialError} />);

  // the same data, handed to the browser so it does not fetch it a second time. Angular calls this
  // the TransferState; React has no name for it and every app writes it out by hand.
  const state = JSON.stringify({ city, initialData, initialError }).replace(/</g, '\\u003c');

  return { html, state };
}
