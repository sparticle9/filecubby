import os
import json
import time
from pathlib import Path
import requests
import redis
import psycopg2
import psycopg2.extras
import io
from dotenv import load_dotenv
from tqdm import tqdm

redis_client = None
db_conn = None

def load_env(env_file='.env'):
    load_dotenv(env_file)

def get_env(var_name, default=None):
    value = os.getenv(var_name)
    if value is None and default is None:
        raise ValueError(f"Environment variable {var_name} is not set and no default provided")
    return value or default

def initialize_connections(store_metadata):
    global redis_client, db_conn
    redis_client = redis.Redis(
        host=get_env('REDIS_HOST'),
        port=int(get_env('REDIS_PORT', '6379')),
        password=get_env('REDIS_PASSWORD'),
        ssl=True
    )
    
    if store_metadata:
        pg_url = get_env('AIVEN_PG_URL')
        if 'sslmode=' not in pg_url:
            pg_url += '?sslmode=require' if '?' not in pg_url else '&sslmode=require'
        db_conn = psycopg2.connect(pg_url, sslmode='no-verify', sslcert=None, sslkey=None, sslrootcert=None)

def create_metadata_table():
    if db_conn:
        with db_conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS file_metadata (
                    file_id TEXT PRIMARY KEY,
                    file_name TEXT NOT NULL,
                    file_size BIGINT NOT NULL,
                    is_chunked BOOLEAN NOT NULL,
                    chunk_size INTEGER,
                    download_url TEXT NOT NULL,
                    upload_time BIGINT NOT NULL,
                    expiry_time BIGINT NOT NULL
                )
            """)
        db_conn.commit()

def split_file(file_path, chunk_size):
    with open(file_path, 'rb') as f:
        chunk_num = 0
        while True:
            chunk = f.read(chunk_size)
            if not chunk:
                break
            yield chunk_num, Path(file_path).name, chunk
            chunk_num += 1

def upload_file(file_path, expiry_time, chunk_size=10*1024*1024, store_metadata=True):
    api_url = get_env('API_URL')
    base_url = '/'.join(api_url.split('/')[:3])  # Get the base URL (scheme + host)
    file_size = Path(file_path).stat().st_size
    file_name = Path(file_path).name

    if file_size <= chunk_size:
        # Single file upload
        with open(file_path, 'rb') as f:
            files = {'image': f}
            with tqdm(total=file_size, unit='B', unit_scale=True, desc=f"Uploading {file_name}") as pbar:
                response = requests.post(api_url, files=files, data={}, stream=True)
                for chunk in response.iter_content(chunk_size=8192):
                    if chunk:
                        pbar.update(len(chunk))
        result = response.json()
        file_id = result['message']
        download_url = f"{base_url}{file_id}"
        print(f"File uploaded. Download URL: {download_url}")
        store_file_expiry(file_id, expiry_time)
        if store_metadata:
            store_metadata_in_db(file_id, file_name, file_size, False, None, download_url, expiry_time)
        return {'file_id': file_id, 'is_chunked': False, 'download_url': download_url}
    else:
        # Chunked upload
        chunk_urls = []
        total_chunks = (file_size + chunk_size - 1) // chunk_size
        with tqdm(total=total_chunks, unit='chunk', desc=f"Uploading {file_name}") as pbar:
            for chunk_num, _, chunk in split_file(file_path, chunk_size):
                files = {'image': (f'{file_name}.part{chunk_num}', chunk)}
                response = requests.post(api_url, files=files)
                # just remove the prefix '/d/' from chunk_id
                chunk_id = response.json()['message'].replace('/d/', '')
                chunk_urls.append(chunk_id)
                print(f"Chunk {chunk_num + 1}/{total_chunks} uploaded. Chunk ID: {chunk_id}")
                pbar.update(1)

        print("Creating manifest file...")
        # Create manifest file content
        manifest_content = "tgstate-blob\n"
        manifest_content += file_name + "\n"
        manifest_content += f"size{file_size}\n"
        manifest_content += "\n".join(chunk_urls)

        manifest_file = io.BytesIO(manifest_content.encode('utf-8'))
        files = {'image': ('fileAll.txt', manifest_file)}
        response = requests.post(api_url, files=files)
        manifest_id = response.json()['message']
        download_url = f"{base_url}{manifest_id}"
        print(f"Manifest file created. Download URL: {download_url}")
        
        store_file_expiry(manifest_id, expiry_time)
        if store_metadata:
            store_metadata_in_db(manifest_id, file_name, file_size, True, chunk_size, download_url, expiry_time)
        return {'file_id': manifest_id, 'is_chunked': True, 'download_url': download_url}

def store_file_expiry(file_id, expiry_time):
    redis_client.zadd('expiring_files', {file_id: expiry_time})

def store_metadata_in_db(file_id, file_name, file_size, is_chunked, chunk_size, download_url, expiry_time):
    if db_conn:
        with db_conn.cursor() as cur:
            cur.execute("""
                INSERT INTO file_metadata 
                (file_id, file_name, file_size, is_chunked, chunk_size, download_url, upload_time, expiry_time)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """, (file_id, file_name, file_size, is_chunked, chunk_size, download_url, int(time.time()), expiry_time))
        db_conn.commit()

def main(env_file='.env'):
    load_env(env_file)
    store_metadata = input("Store metadata in database? (y/n): ").lower() != 'n'
    initialize_connections(store_metadata)
    if store_metadata:
        create_metadata_table()

    file_path = input("Enter the file path: ")
    expiry_hours = int(input("Enter expiry time in hours: "))
    expiry_time = int(time.time()) + expiry_hours * 3600
    chunk_size = 10 * 1024 * 1024  # 20MB chunks

    result = upload_file(file_path, expiry_time, chunk_size, store_metadata)
    print(f"File uploaded successfully. Download URL: {result['download_url']}")

if __name__ == "__main__":
    import sys
    env_file = sys.argv[1] if len(sys.argv) > 1 else '.env'
    main(env_file)