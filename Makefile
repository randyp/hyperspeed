.PHONY: start stop clean install test-outgoing-call convert-audio clean-wav test-joystick

start: convert-audio
	npm start

stop:
	pkill -f electron || true

test-outgoing-call:
	node test-phone.js

test-joystick:
	node test-joystick.js

convert-audio:
	@echo "Converting MP3 files to WAV format..."
	@find sounds -name "*.mp3" | while read mp3file; do \
		wavfile="$${mp3file%.mp3}.wav"; \
		if [ ! -f "$$wavfile" ]; then \
			echo "Converting $$mp3file -> $$wavfile"; \
			if echo "$$mp3file" | grep -qE "(outgoing_calls|incoming_calls)"; then \
				ffmpeg -i "$$mp3file" -ar 8000 -ac 1 -sample_fmt s16 "$$wavfile" -y; \
			else \
				ffmpeg -i "$$mp3file" "$$wavfile" -y; \
			fi; \
		else \
			echo "Skipping $$mp3file (WAV already exists)"; \
		fi; \
	done
	@echo "Audio conversion complete!"

clean-wav:
	@echo "Removing WAV files that have corresponding MP3 files..."
	@find sounds -name "*.wav" | while read wavfile; do \
		mp3file="$${wavfile%.wav}.mp3"; \
		if [ -f "$$mp3file" ]; then \
			echo "Removing $$wavfile (MP3 exists)"; \
			rm "$$wavfile"; \
		fi; \
	done
	@echo "WAV cleanup complete!"

clean: clean-wav
	rm -rf node_modules package-lock.json

install:
	npm install
