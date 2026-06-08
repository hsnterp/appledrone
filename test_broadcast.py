import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
sock.bind(('', 8889))
sock.settimeout(5.0)

# Try broadcast
broadcast_address = ('192.168.10.255', 8889)

print("Sending broadcast command...")
sock.sendto(b'command', broadcast_address)

try:
    response, ip = sock.recvfrom(1024)
    print(f"✓ Response from {ip}: {response.decode()}")
except socket.timeout:
    print("✗ No response")
except Exception as e:
    print(f"✗ Error: {e}")

sock.close()