import os
import json
import httpx
from pathlib import Path
from tqdm import tqdm
from dotenv import load_dotenv
import asyncio
import ssl
import certifi
import socket

load_dotenv()

def get_env(key):
    value = os.getenv(key)
    if not value:
        raise ValueError(f"{key} is not set in the environment variables")
    return value

async def upload_chunk(client, api_url, headers, file_path, chunk_number, chunk_size, start_byte, file_size):
    with open(file_path, 'rb') as f:
        f.seek(start_byte)
        chunk = f.read(chunk_size)
    
    files = {'file': (f'{Path(file_path).name}.part{chunk_number}', chunk)}
    data = {
        'isChunk': 'true',
        'chunkIndex': str(chunk_number),
        'totalChunks': str((file_size + chunk_size - 1) // chunk_size)
    }
    
    response = await client.post(api_url, headers=headers, files=files, data=data)
    return response.json()

async def upload_manifest(client, api_url, headers, file_name, file_size, chunk_ids, file_type, expiry_hours):
    manifest = {
        'fileName': file_name,
        'fileSize': file_size,
        'chunkIds': chunk_ids,
        'fileType': file_type,
        'expiryHours': expiry_hours
    }
    
    files = {'file': (f'{file_name}.manifest', json.dumps(manifest))}
    data = {'isManifest': 'true'}
    
    response = await client.post(api_url, headers=headers, files=files, data=data)
    return response.json()

async def upload_file(file_path, expiry_hours, token, chunk_size=19*1024*1024, max_retries=3):
    api_url = get_env('API_URL')
    file_size = Path(file_path).stat().st_size
    file_name = Path(file_path).name

    headers = {
        "Authorization": f"Bearer {token}"
    }

    ssl_context = ssl.create_default_context(cafile=certifi.where())
    
    print(f"Attempting to upload to {api_url}")
    print(f"File size: {file_size} bytes")
    print(f"Chunk size: {chunk_size} bytes")

    async with httpx.AsyncClient(timeout=httpx.Timeout(timeout=None), verify=ssl_context) as client:
        if file_size <= chunk_size:
            # Single file upload
            for attempt in range(max_retries):
                try:
                    with open(file_path, 'rb') as f:
                        files = {'file': (file_name, f)}
                        data = {'expiryHours': str(expiry_hours)} if expiry_hours else {}
                        
                        with tqdm(total=file_size, unit='B', unit_scale=True, desc=f"Uploading {file_name} (Attempt {attempt + 1})") as pbar:
                            response = await client.post(api_url, headers=headers, files=files, data=data)
                            pbar.update(file_size)

                    result = response.json()
                    if result.get('Code') == 1:
                        print(f"File uploaded successfully. URL: {result.get('url')}")
                        return result.get('url')
                    else:
                        print(f"Error uploading file: {result.get('Message')}")
                        if attempt < max_retries - 1:
                            print(f"Retrying in 5 seconds...")
                            await asyncio.sleep(5)
                        else:
                            print("Max retries reached. Upload failed.")
                            return None
                except Exception as e:
                    print(f"Error during upload (attempt {attempt + 1}): {e}")
                    if attempt < max_retries - 1:
                        print(f"Retrying in 5 seconds...")
                        await asyncio.sleep(5)
                    else:
                        print("Max retries reached. Upload failed.")
                        return None
        else:
            # Chunked upload
            total_chunks = (file_size + chunk_size - 1) // chunk_size
            chunk_ids = []
            with tqdm(total=total_chunks, unit='chunk', desc=f"Uploading {file_name}") as pbar:
                for chunk_number in range(total_chunks):
                    start_byte = chunk_number * chunk_size
                    for attempt in range(max_retries):
                        try:
                            result = await upload_chunk(client, api_url, headers, file_path, chunk_number, chunk_size, start_byte, file_size)
                            if result.get('Code') == 1:
                                chunk_ids.append(result.get('chunkId'))
                                pbar.update(1)
                                break
                            else:
                                print(f"Error uploading chunk {chunk_number + 1}: {result.get('Message')}")
                                if attempt < max_retries - 1:
                                    print(f"Retrying chunk {chunk_number + 1} in 5 seconds...")
                                    await asyncio.sleep(5)
                                else:
                                    print(f"Max retries reached for chunk {chunk_number + 1}. Upload failed.")
                                    return None
                        except Exception as e:
                            print(f"Error uploading chunk {chunk_number + 1} (attempt {attempt + 1}): {e}")
                            if attempt < max_retries - 1:
                                print(f"Retrying chunk {chunk_number + 1} in 5 seconds...")
                                await asyncio.sleep(5)
                            else:
                                print(f"Max retries reached for chunk {chunk_number + 1}. Upload failed.")
                                return None
            
            print("All chunks uploaded successfully. Uploading manifest...")
            file_type = Path(file_path).suffix[1:]  # Get file extension without the dot
            manifest_result = await upload_manifest(client, api_url, headers, file_name, file_size, chunk_ids, file_type, expiry_hours)
            
            if manifest_result.get('Code') == 1:
                print("Manifest uploaded successfully.")
                download_url = manifest_result.get('url')
                print(f"File uploaded successfully. URL: {download_url}")
                return download_url
            else:
                print(f"Error uploading manifest: {manifest_result.get('Message')}")
                return None

async def main():
    import argparse
    parser = argparse.ArgumentParser(description="Upload a file to the server")
    parser.add_argument("file_path", help="Path to the file to upload")
    parser.add_argument("--expiry", type=int, help="Expiry time in hours")
    parser.add_argument("--token", help="Authentication token")
    args = parser.parse_args()

    token = args.token or get_env('AUTH_TOKEN')
    result = await upload_file(args.file_path, args.expiry, token)
    if result:
        print(f"Download URL: {result}")
    else:
        print("Upload failed.")

if __name__ == "__main__":
    asyncio.run(main())