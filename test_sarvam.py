import app
with open("test_out.txt", "w") as f:
    f.write(app.get_sarvam_notes("test chunk"))
