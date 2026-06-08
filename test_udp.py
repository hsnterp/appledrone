import socket
import time

# Create UDP socket
sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.settimeout(5.0)

# Bind to local port
sock.bind(('', 8889))

tello_address = ('192.168.10.1', 8889)

print("Sending 'command' to Tello...")
sock.sendto(b'command', tello_address)

try:
    response, ip = sock.recvfrom(1024)
    print(f"✓ Response from {ip}: {response.decode()}")
except socket.timeout:
    print("✗ No response from Tello (timeout)")
except Exception as e:
    print(f"✗ Error: {e}")

sock.close()
