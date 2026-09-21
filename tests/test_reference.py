import tempfile
import unittest
from pathlib import Path
import numpy as np
import soundfile as sf
from speech.reference import read_reference, SAMPLE_RATE

class ReferenceTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.path = Path(self.folder.name) / 'sample.wav'
    def tearDown(self):
        self.folder.cleanup()
    def record(self, seconds, silent=False):
        t = np.arange(round(seconds * SAMPLE_RATE)) / SAMPLE_RATE
        sf.write(self.path, np.zeros_like(t) if silent else np.sin(2*np.pi*220*t)*0.2, SAMPLE_RATE)
    def test_long_source_inspection_and_selected_segment(self):
        self.record(74)
        _, duration = read_reference(str(self.path), validate=False)
        self.assertEqual(duration, 74)
        samples, duration = read_reference(str(self.path), 10, 22)
        self.assertEqual(len(samples), 12*SAMPLE_RATE)
        self.assertEqual(duration, 74)
    def test_long_source_without_segment_has_actionable_error(self):
        self.record(74)
        with self.assertRaisesRegex(ValueError, '74.0 seconds.*Edit voice'):
            read_reference(str(self.path))
    def test_limits_are_inclusive(self):
        self.record(35)
        for start,end in [(0,3),(5,35)]:
            self.assertEqual(len(read_reference(str(self.path),start,end)[0]),(end-start)*SAMPLE_RATE)
    def test_short_silent_and_out_of_bounds_are_rejected(self):
        self.record(10)
        for start,end in [(0,2),(-1,5),(3,20),(float('nan'),5),(4,3)]:
            with self.assertRaises(ValueError): read_reference(str(self.path),start,end)
        self.record(5, silent=True)
        with self.assertRaisesRegex(ValueError,'silent'): read_reference(str(self.path))
    def test_mp3_decodes_and_can_be_clipped(self):
        self.record(12)
        data,sr=sf.read(self.path)
        mp3=self.path.with_suffix('.mp3');sf.write(mp3,data,sr,format='MP3')
        self.assertEqual(len(read_reference(str(mp3),2,8)[0]),6*SAMPLE_RATE)
    def test_invalid_file(self):
        self.path.write_bytes(b'not audio')
        with self.assertRaisesRegex(ValueError,'could not be decoded'): read_reference(str(self.path))

if __name__ == '__main__': unittest.main()
