import requests

from firebase_upload import upload_to_firebase

TEST_PNG_BYTES = bytes.fromhex(
    "89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C489"
    "0000000D49444154789C6360606060000000050001A5F645400000000049454E44AE426082"
)


def main() -> None:
    download_url = upload_to_firebase(TEST_PNG_BYTES, folder="test")
    response = requests.get(download_url, timeout=20)
    response.raise_for_status()
    print("SUCCESS:", download_url)


if __name__ == "__main__":
    main()
