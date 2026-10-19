/// <reference types="node" />
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ImportError, detectFormat, mergeSegments, parseTrackFile } from '../src/parse';
import { parseGeojson } from '../src/parse/geojson';
import { decodeXml, parseGpx } from '../src/parse/gpx';
import { parseKml } from '../src/parse/kml';

const enc = (s: string): ArrayBuffer => {
  const bytes = new TextEncoder().encode(s);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
};

const GPX = `<?xml version="1.0"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="61.1" lon="29.9"><name>Озеро &amp; скала</name><desc><![CDATA[Тут <b>купались</b>]]></desc></wpt>
  <trk><name>t</name>
    <trkseg>
      <trkpt lat="61.0" lon="29.0"><ele>10.5</ele><time>2026-10-17T10:00:00Z</time>
        <extensions><ns3:TrackPointExtension><ns3:speed>1</ns3:speed></ns3:TrackPointExtension></extensions>
      </trkpt>
      <trkpt lon='29.001' lat='61.001'><time>2026-10-17T10:00:10Z</time></trkpt>
    </trkseg>
    <trkseg>
      <trkpt lat="61.002" lon="29.002"/>
      <trkpt lat="bad" lon="29.003"/>
    </trkseg>
  </trk>
</gpx>`;

describe('parseGpx', () => {
  const parsed = parseGpx(GPX);

  it('сегменты, высота и время', () => {
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toEqual([
      { lat: 61, lon: 29, ele: 10.5, t: Date.parse('2026-10-17T10:00:00Z') / 1000 },
      { lat: 61.001, lon: 29.001, t: Date.parse('2026-10-17T10:00:10Z') / 1000 },
    ]);
  });

  it('пропускает точки с неверными координатами, понимает самозакрытые теги', () => {
    expect(parsed.segments[1]).toEqual([{ lat: 61.002, lon: 29.002 }]);
  });

  it('метки wpt с разбором сущностей и CDATA', () => {
    expect(parsed.waypoints).toEqual([
      { lat: 61.1, lon: 29.9, name: 'Озеро & скала', desc: 'Тут <b>купались</b>' },
    ]);
  });

  it('маршрут rte, если треков нет', () => {
    const p = parseGpx(
      '<gpx><rte><rtept lat="1" lon="2"/><rtept lat="1.1" lon="2.1"/></rte></gpx>',
    );
    expect(p.segments).toEqual([
      [
        { lat: 1, lon: 2 },
        { lat: 1.1, lon: 2.1 },
      ],
    ]);
  });

  it('decodeXml', () => {
    expect(decodeXml('a &lt;b&gt; &#1046; &#x41;')).toBe('a <b> Ж A');
  });
});

describe('parseGpx на вырезке из эталона', () => {
  it('1800 точек со временем и высотой', () => {
    const parsed = parseGpx(readFileSync('test/fixtures/zepp-slice.gpx', 'utf8'));
    expect(parsed.segments).toHaveLength(1);
    const seg = parsed.segments[0] ?? [];
    expect(seg).toHaveLength(1800);
    expect(seg.every((p) => p.t !== undefined && p.ele !== undefined)).toBe(true);
    expect(seg[0]).toEqual({
      lat: 61.113192,
      lon: 29.875008,
      ele: 9.55,
      t: Date.parse('2026-10-17T09:54:21Z') / 1000,
    });
  });
});

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document>
  <Placemark><name>Линия</name>
    <LineString><coordinates>29.0,61.0,10 29.001,61.001,12</coordinates></LineString>
  </Placemark>
  <Placemark><name>Трек</name>
    <gx:Track>
      <when>2026-10-17T10:00:00Z</when><when>2026-10-17T10:00:05Z</when>
      <gx:coord>29.1 61.1 5</gx:coord><gx:coord>29.101 61.101 6</gx:coord>
    </gx:Track>
  </Placemark>
  <Placemark><name>Привал</name><description>Чай</description>
    <Point><coordinates>29.5,61.5</coordinates></Point>
  </Placemark>
</Document>
</kml>`;

describe('parseKml', () => {
  const parsed = parseKml(KML);

  it('LineString без времени и gx:Track со временем', () => {
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0]).toEqual([
      { lat: 61, lon: 29, ele: 10 },
      { lat: 61.001, lon: 29.001, ele: 12 },
    ]);
    expect(parsed.segments[1]?.[1]).toEqual({
      lat: 61.101,
      lon: 29.101,
      ele: 6,
      t: Date.parse('2026-10-17T10:00:05Z') / 1000,
    });
  });

  it('точка — метка', () => {
    expect(parsed.waypoints).toEqual([{ lat: 61.5, lon: 29.5, name: 'Привал', desc: 'Чай' }]);
  });
});

describe('parseGeojson', () => {
  it('FeatureCollection с MultiLineString и временем', () => {
    const fc = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {
            coordinateProperties: {
              times: [['2026-10-17T10:00:00Z', '2026-10-17T10:00:01Z'], ['2026-10-17T11:00:00Z']],
            },
          },
          geometry: {
            type: 'MultiLineString',
            coordinates: [
              [
                [29, 61, 1],
                [29.1, 61.1, 2],
              ],
              [[29.2, 61.2]],
            ],
          },
        },
        {
          type: 'Feature',
          properties: { name: 'М' },
          geometry: { type: 'Point', coordinates: [1, 2] },
        },
      ],
    };
    const parsed = parseGeojson(JSON.stringify(fc));
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[1]).toEqual([
      { lat: 61.2, lon: 29.2, t: Date.parse('2026-10-17T11:00:00Z') / 1000 },
    ]);
    expect(parsed.waypoints).toEqual([{ lat: 2, lon: 1, name: 'М', desc: '' }]);
  });

  it('голая геометрия LineString и Feature', () => {
    const line = {
      type: 'LineString',
      coordinates: [
        [1, 2],
        [3, 4],
      ],
    };
    expect(parseGeojson(JSON.stringify(line)).segments).toHaveLength(1);
    const feature = { type: 'Feature', properties: null, geometry: line };
    expect(parseGeojson(JSON.stringify(feature)).segments).toHaveLength(1);
  });

  it('битый JSON — пусто', () => {
    expect(parseGeojson('{oops')).toEqual({ segments: [], waypoints: [] });
  });
});

describe('detectFormat', () => {
  const b = (s: string) => new TextEncoder().encode(s);
  it('по расширению', () => {
    expect(detectFormat('a.GPX', b(''))).toBe('gpx');
    expect(detectFormat('a.kmz', b(''))).toBe('kmz');
    expect(detectFormat('a.geojson', b(''))).toBe('geojson');
  });
  it('по содержимому', () => {
    expect(detectFormat('track', b('﻿<?xml version="1.0"?>\n<gpx version="1.1">'))).toBe('gpx');
    expect(detectFormat('track', b('<?xml?><kml xmlns="x">'))).toBe('kml');
    expect(detectFormat('track', b('  {"type":"Feature"}'))).toBe('geojson');
    expect(detectFormat('track', new Uint8Array([0x50, 0x4b, 3, 4]))).toBe('kmz');
    expect(detectFormat('photo.jpg', new Uint8Array([0xff, 0xd8]))).toBeNull();
  });
});

describe('parseTrackFile', () => {
  it('ошибка «формат не поддерживается»', async () => {
    await expect(parseTrackFile('x.jpg', new Uint8Array([0xff, 0xd8]).buffer)).rejects.toThrow(
      'Формат не поддерживается',
    );
  });

  it('ошибка «в файле нет трека», если есть только метки', async () => {
    const err = await parseTrackFile('a.gpx', enc('<gpx><wpt lat="1" lon="2"/></gpx>')).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).code).toBe('no-track');
  });

  it('ошибка «файл больше 50 МБ»', async () => {
    await expect(parseTrackFile('a.gpx', new ArrayBuffer(50 * 1024 * 1024 + 1))).rejects.toThrow(
      'Файл больше 50 МБ',
    );
  });

  it('KMZ: распаковывает doc.kml', async () => {
    const zip = new JSZip();
    zip.file('doc.kml', KML);
    const data = await zip.generateAsync({ type: 'arraybuffer' });
    const parsed = await parseTrackFile('trip.kmz', data);
    expect(parsed.segments).toHaveLength(2);
  });
});

describe('mergeSegments', () => {
  it('со временем — сортирует сегменты по началу', () => {
    const a = [{ lat: 1, lon: 1, t: 200 }];
    const b = [{ lat: 2, lon: 2, t: 100 }];
    expect(mergeSegments([a, b])).toEqual([...b, ...a]);
  });
  it('без времени хоть у одной точки — порядок файла', () => {
    const a = [{ lat: 1, lon: 1, t: 200 }];
    const b = [{ lat: 2, lon: 2 }];
    expect(mergeSegments([a, [], b])).toEqual([...a, ...b]);
  });
});
