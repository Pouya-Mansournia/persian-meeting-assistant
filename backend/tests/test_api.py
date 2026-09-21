import pytest
from fastapi.testclient import TestClient
from backend import main


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(main, 'DATA', tmp_path)
    with TestClient(main.app) as c:
        yield c


def seed(client, **overrides):
    item = dict(id='example', title='جلسه محصول', started_at='2026-09-20', duration=30, status='ready', audio_path=None, delete_audio=False, vocabulary='CVR', segments=[dict(start=0, end=30, text='علی داده را بررسی می‌کند')], intelligence=dict(summary='بررسی داده', decisions=[], questions=[], topics=[], actions=[dict(description='بررسی داده', owner='علی', deadline=None, done=False)]), error=None)
    item.update(overrides)
    main.save(item)
    return item


def test_persistence_actions_and_delete(client):
    seed(client)
    assert client.get('/api/meetings').json()[0]['title'] == 'جلسه محصول'
    result = client.patch('/api/meetings/example/actions/0', json={'done': True})
    assert result.json()['intelligence']['actions'][0]['done'] is True
    assert client.patch('/api/meetings/example/actions/-1', json={'done': True}).status_code == 404
    assert client.delete('/api/meetings/example').status_code == 204
    assert client.get('/api/meetings/example').status_code == 404


def test_invalid_uploads_leave_no_audio(client, monkeypatch):
    assert client.post('/api/meetings', data={'title':'جلسه'}, files={'audio':('test.wav', b'')}).status_code == 422
    monkeypatch.setattr(main, 'MAX_UPLOAD', 3)
    assert client.post('/api/meetings', data={'title':'جلسه'}, files={'audio':('test.wav', b'1234')}).status_code == 413
    assert not list(main.DATA.glob('*.audio'))


def test_upload_failure_then_retry(client, monkeypatch):
    monkeypatch.setattr(main.shutil, 'which', lambda _: None)
    result = client.post('/api/meetings', data={'title':'جلسه'}, files={'audio':('test.wav', b'audio')})
    assert result.status_code == 201
    mid = result.json()['id']
    assert client.get('/api/meetings/'+mid).json()['status'] == 'failed'
    assert client.post('/api/meetings/'+mid+'/retry').status_code == 200
    assert client.get('/api/meetings/'+mid).json()['audio_path'] is not None


def test_summary_failure_preserves_transcript_and_honors_retention(client, monkeypatch):
    audio = main.DATA / 'recording.audio'
    audio.write_bytes(b'audio')
    seed(client, audio_path=str(audio), delete_audio=True)
    def fail(_):
        raise RuntimeError('Ollama unavailable')
    monkeypatch.setattr(main, 'extract', fail)
    main.process('example')
    item = main.get('example')
    assert item['status'] == 'failed'
    assert item['segments']
    assert not audio.exists()
    assert item['audio_path'] is None
    monkeypatch.setattr(main, 'extract', lambda _: main.Intelligence(summary='خلاصه').model_dump())
    assert client.post('/api/meetings/example/retry').status_code == 200
    assert main.get('example')['status'] == 'ready'


def test_restart_and_processing_guards(client):
    seed(client, status='transcribing')
    assert client.delete('/api/meetings/example').status_code == 409
    assert client.post('/api/meetings/example/retry').status_code == 409
    main.initialize()
    assert main.get('example')['status'] == 'failed'


def test_missing_audio_and_meeting(client):
    seed(client)
    assert client.get('/api/meetings/example/audio').status_code == 404
    assert client.get('/api/meetings/missing').status_code == 404


def test_long_transcripts_keep_tail_and_deduplicate(monkeypatch):
    captured = []
    def fake(chunk):
        captured.append(chunk)
        return main.Intelligence(summary=chunk[-40:], decisions=['تصمیم'], actions=[main.Action(description='کار')]).model_dump()
    monkeypatch.setattr(main, 'extract_chunk', fake)
    text = ('این یک متن طولانی برای بررسی جلسه است.\n' * 1000) + 'پایان مهم جلسه'
    result = main.extract(text)
    assert len(captured) > 1
    assert 'پایان مهم جلسه' in captured[-1]
    assert result['decisions'] == ['تصمیم']
    assert len(result['actions']) == 1
    assert ''.join(captured).replace('\n', '') == text.replace('\n', '')



def test_other_websites_cannot_access_local_api(client):
    assert client.get('/api/meetings', headers={'origin':'https://untrusted.example'}).status_code == 403
    assert client.get('/api/meetings', headers={'host':'untrusted.example'}).status_code == 403
    assert client.get('/api/meetings', headers={'sec-fetch-site':'cross-site'}).status_code == 403
    assert client.get('/api/meetings', headers={'origin':'http://127.0.0.1:5173'}).status_code == 200



def test_settings_survive_backend_restart(client):
    assert client.get('/api/settings').json()['delete_audio'] is False
    saved = {'vocabulary': 'Retention, تیم محصول', 'delete_audio': True}
    assert client.put('/api/settings', json=saved).status_code == 200
    main.initialize()
    assert client.get('/api/settings').json() == saved
    assert client.put('/api/settings', json={'vocabulary': 'a' * 3001}).status_code == 422



def test_model_contract_requires_all_categories():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        main.Extraction.model_validate({'summary': 'خلاصه'})
    assert set(main.Extraction.model_json_schema()['required']) == {
        'summary', 'decisions', 'actions', 'questions', 'topics'
    }


def test_extraction_never_marks_ai_tasks_done(monkeypatch):
    import io
    import json
    output = dict(summary='خلاصه', decisions=[], actions=[dict(description='کار', owner=None, deadline=None, done=True)], questions=[], topics=[])
    monkeypatch.setattr(main, 'urlopen', lambda *a, **kw: io.StringIO(json.dumps({'message': {'content': json.dumps(output)}})))
    assert main.extract_chunk('متن')['actions'][0]['done'] is False


def test_speech_readiness_uses_runtime_files_not_repository_docs(client, monkeypatch, tmp_path):
    import io
    import json
    from faster_whisper import utils
    (tmp_path / 'model.bin').write_bytes(b'weights')
    calls = []
    def resolve(model, *, local_files_only):
        calls.append((model, local_files_only))
        return str(tmp_path)
    monkeypatch.setattr(utils, 'download_model', resolve)
    monkeypatch.setattr(main.shutil, 'which', lambda name: '/test/ffmpeg')
    monkeypatch.setattr(main, 'urlopen', lambda *args, **kwargs: io.StringIO(json.dumps({'models': [{'name': 'qwen2.5:7b'}]})))
    result = client.get('/api/health').json()
    assert result['ready'] is True
    assert result['speech_ready'] is True
    assert calls == [('large-v3', True)]



def test_extraction_requires_explicit_owner_and_deadline_fields():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        main.ExtractedAction.model_validate({'description': 'کار'})
    assert set(main.ExtractedAction.model_json_schema()['required']) == {'description', 'owner', 'deadline'}
