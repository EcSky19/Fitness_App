/* eslint-env jest */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import React from 'react';

import { analyzeImage, imageUriToBase64 } from '@/services/vision';
import type { VisionResult } from '@/types';

import ScanScreen from '../../../../app/scan';
import { makeVisionResult } from './testKit';

jest.mock('@/ui', () => require('./testKit').makeUiMock());
jest.mock('@/services/vision', () => require('./testKit').makeVisionServiceMock());

jest.mock('@expo/vector-icons', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return {
    Ionicons: ({ name }: { name: string }) => React.createElement(Text, null, name),
  };
});

jest.mock('expo-router', () => ({
  router: {
    push: jest.fn(),
    replace: jest.fn(),
    back: jest.fn(),
    dismiss: jest.fn(),
    dismissAll: jest.fn(),
    canDismiss: jest.fn(() => true),
    canGoBack: jest.fn(() => true),
  },
  useLocalSearchParams: jest.fn(() => ({})),
}));

const mockedParams = useLocalSearchParams as unknown as jest.Mock;
const mockedPermissions = useCameraPermissions as unknown as jest.Mock;
const mockedAnalyze = analyzeImage as unknown as jest.Mock;
const mockedToBase64 = imageUriToBase64 as unknown as jest.Mock;
const mockedLibrary = ImagePicker.launchImageLibraryAsync as unknown as jest.Mock;

const GRANTED = { granted: true, canAskAgain: true, status: 'granted' };

function grant(permission: object = GRANTED, request = jest.fn()) {
  mockedPermissions.mockImplementation(() => [permission, request]);
  return request;
}

function payloadOf(href: string): VisionResult {
  const encoded = href.slice(href.indexOf('payload=') + 'payload='.length).split('&')[0];
  return JSON.parse(decodeURIComponent(encoded)) as VisionResult;
}

beforeEach(() => {
  mockedParams.mockReturnValue({ date: '2026-08-19', mealType: 'lunch' });
  grant();
  mockedToBase64.mockResolvedValue({ base64: 'BASE64', mimeType: 'image/jpeg' });
  mockedAnalyze.mockResolvedValue({ ok: true, data: makeVisionResult() });
  mockedLibrary.mockResolvedValue({ canceled: true, assets: null });
});

describe('scan screen - camera', () => {
  it('shows the mode switch, the hint and the framing guide', () => {
    render(<ScanScreen />);

    expect(screen.getByTestId('shutter-button')).toBeTruthy();
    expect(screen.getByText('Fill the frame with your plate')).toBeTruthy();
    expect(screen.getByTestId('framing-guide-food_photo')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Nutrition label'));

    expect(screen.getByText('Line up the Nutrition Facts panel')).toBeTruthy();
    expect(screen.getByTestId('framing-guide-nutrition_label')).toBeTruthy();
  });

  it('captures, analyses and hands the result to the review screen', async () => {
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(router.replace).toHaveBeenCalled());

    expect(mockedAnalyze).toHaveBeenCalledWith({
      imageBase64: 'BASE64',
      mimeType: 'image/jpeg',
      mode: 'food_photo',
    });

    const href = (router.replace as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(href.startsWith('/scan-review?payload=')).toBe(true);
    expect(href).toContain('&mealType=lunch');
    expect(href).toContain('&date=2026-08-19');
    expect(href).toContain(encodeURIComponent('file:///mock/photo.jpg'));
    expect(payloadOf(href).items).toHaveLength(2);
  });

  it('analyses a label scan in nutrition_label mode', async () => {
    render(<ScanScreen />);

    fireEvent.press(screen.getByLabelText('Nutrition label'));
    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(mockedAnalyze).toHaveBeenCalled());
    expect(mockedAnalyze.mock.calls[0][0].mode).toBe('nutrition_label');
  });

  it('ignores a double tap on the shutter', async () => {
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));
    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(router.replace).toHaveBeenCalledTimes(1));
    expect(mockedAnalyze).toHaveBeenCalledTimes(1);
  });

  it('picks an image from the library with the SDK 54 media type array', async () => {
    mockedLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///library/pic.jpg' }],
    });
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('gallery-button'));

    await waitFor(() => expect(mockedAnalyze).toHaveBeenCalled());
    expect(mockedLibrary).toHaveBeenCalledWith(
      expect.objectContaining({ mediaTypes: ['images'], quality: 0.6 })
    );
    expect(mockedToBase64).toHaveBeenCalledWith('file:///library/pic.jpg');
  });

  it('can cancel an analysis and go back to the camera', async () => {
    let release: ((value: unknown) => void) | null = null;
    mockedAnalyze.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));
    await waitFor(() => expect(screen.getByTestId('analyzing-overlay')).toBeTruthy());
    expect(screen.getByTestId('analyzing-status')).toBeTruthy();

    fireEvent.press(screen.getByTestId('analyzing-cancel'));
    expect(screen.queryByTestId('analyzing-overlay')).toBeNull();

    await act(async () => {
      release?.({ ok: true, data: makeVisionResult() });
    });

    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('scan screen - failures', () => {
  it('offers retry, manual entry and the API key shortcut', async () => {
    mockedAnalyze.mockResolvedValue({ ok: false, error: 'Missing API key for openai' });
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(screen.getByTestId('scan-error-card')).toBeTruthy());
    expect(screen.getByText('Missing API key for openai')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Add API key'));
    expect(router.push).toHaveBeenCalledWith('/settings');

    fireEvent.press(screen.getByLabelText('Enter manually'));
    const href = (router.replace as unknown as jest.Mock).mock.calls[0][0] as string;
    expect(href.startsWith('/food-edit?draft=')).toBe(true);
    const draft = JSON.parse(
      decodeURIComponent(href.slice('/food-edit?draft='.length).split('&')[0])
    );
    expect(draft).toMatchObject({ date: '2026-08-19', mealType: 'lunch', source: 'quick_add' });

    mockedAnalyze.mockResolvedValue({ ok: true, data: makeVisionResult() });
    fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(mockedAnalyze).toHaveBeenCalledTimes(2));
  });

  it('hides the API key shortcut for unrelated failures', async () => {
    mockedAnalyze.mockResolvedValue({ ok: false, error: 'The network dropped out' });
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(screen.getByTestId('scan-error-card')).toBeTruthy());
    expect(screen.queryByLabelText('Add API key')).toBeNull();
  });

  it('explains when nothing edible was found', async () => {
    mockedAnalyze.mockResolvedValue({ ok: true, data: makeVisionResult({ items: [] }) });
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('shutter-button'));

    await waitFor(() => expect(screen.getByTestId('no-food-card')).toBeTruthy());
    expect(screen.getByText('No food detected')).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('back-to-camera'));
    expect(screen.queryByTestId('no-food-card')).toBeNull();
    expect(screen.getByTestId('shutter-button')).toBeTruthy();
  });
});

describe('scan screen - permissions', () => {
  it('asks for the camera when it can', () => {
    const request = grant({ granted: false, canAskAgain: true, status: 'undetermined' });
    render(<ScanScreen />);

    expect(screen.getByTestId('camera-rationale')).toBeTruthy();
    fireEvent.press(screen.getByTestId('allow-camera'));
    expect(request).toHaveBeenCalled();
  });

  it('points at the system settings once the camera was denied for good', () => {
    grant({ granted: false, canAskAgain: false, status: 'denied' });
    render(<ScanScreen />);

    expect(screen.getByTestId('camera-denied')).toBeTruthy();
    expect(screen.getByText('Camera is turned off')).toBeTruthy();
    expect(screen.getByTestId('permission-gallery')).toBeTruthy();
  });

  it('still analyses a library photo while the camera is blocked', async () => {
    grant({ granted: false, canAskAgain: false, status: 'denied' });
    mockedLibrary.mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: 'file:///library/pic.jpg' }],
    });
    render(<ScanScreen />);

    fireEvent.press(screen.getByTestId('permission-gallery'));

    await waitFor(() => expect(router.replace).toHaveBeenCalled());
    expect((router.replace as unknown as jest.Mock).mock.calls[0][0]).toContain('/scan-review');
  });

  it('waits quietly while the permission is still unknown', () => {
    grant(null as unknown as object);
    render(<ScanScreen />);

    expect(screen.getByText('Checking camera access…')).toBeTruthy();
  });
});
