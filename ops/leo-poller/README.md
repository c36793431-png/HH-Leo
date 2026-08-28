# Leo Telegram poller — durability copy

`leo_poller.py` is the live copy from `/root/claudeclaw-leo/leo_poller.py` on
the Ubuntu-Leo WSL distro, checked in here so it survives a distro rebuild or
rollback. It previously existed only on that distro's disk with no version
control — see the 2026-08-28 poller-hang incident (`getaddrinfo` blocking past
the `urlopen` socket timeout during boot DNS resolution, fixed with a bounded
request wrapper `bus_req_bounded`).

Runs under systemd service `claude-tg-leo` on Ubuntu-Leo. The systemd unit
file itself lives outside this session's reachable filesystem
(`/root/claudeclaw-leo` only) and was not able to be captured here — whoever
next touches the service definition should add it alongside this file.

To refresh this copy after editing the live file:

    cp /root/claudeclaw-leo/leo_poller.py ops/leo-poller/leo_poller.py
