-- RTM Send Installer
-- Copies VST3 and AU to ~/Library/Audio/Plug-Ins (user-level, no admin required)
-- For system-level install it prompts for admin password

on run
    set appPath to POSIX path of (path to me)
    
    -- Find plugin source relative to this app
    -- The installer app sits next to the plugins in the DMG
    set dmgContents to do shell script "dirname " & quoted form of appPath
    set vst3Source to dmgContents & "/RTM Send.vst3"
    set auSource to dmgContents & "/RTM Send.component"
    
    -- Verify sources exist
    try
        do shell script "test -d " & quoted form of vst3Source
        do shell script "test -d " & quoted form of auSource
    on error
        display dialog "Installation files not found. Please re-download RTM Send." buttons {"OK"} default button "OK" with icon stop
        return
    end try
    
    -- Ask install level
    set installChoice to button returned of (display dialog "Where would you like to install RTM Send?

• This User Only — installs to your personal plugin folder (no password needed)
• All Users — installs system-wide (requires admin password)" ¬
        buttons {"Cancel", "This User Only", "All Users"} ¬
        default button "This User Only" ¬
        with icon note ¬
        with title "Install RTM Send")
    
    if installChoice is "Cancel" then return
    
    if installChoice is "This User Only" then
        -- User-level: ~/Library/Audio/Plug-Ins
        set vst3Dest to (POSIX path of (path to home folder)) & "Library/Audio/Plug-Ins/VST3"
        set auDest to (POSIX path of (path to home folder)) & "Library/Audio/Plug-Ins/Components"
        
        do shell script "mkdir -p " & quoted form of vst3Dest
        do shell script "mkdir -p " & quoted form of auDest
        do shell script "rm -rf " & quoted form of (vst3Dest & "/RTM Send.vst3")
        do shell script "rm -rf " & quoted form of (auDest & "/RTM Send.component")
        do shell script "cp -R " & quoted form of vst3Source & " " & quoted form of vst3Dest & "/"
        do shell script "cp -R " & quoted form of auSource & " " & quoted form of auDest & "/"
        do shell script "xattr -cr " & quoted form of (vst3Dest & "/RTM Send.vst3")
        do shell script "xattr -cr " & quoted form of (auDest & "/RTM Send.component")
        
    else
        -- System-level: /Library/Audio/Plug-Ins (needs admin)
        set vst3Dest to "/Library/Audio/Plug-Ins/VST3"
        set auDest to "/Library/Audio/Plug-Ins/Components"
        
        do shell script "mkdir -p " & quoted form of vst3Dest & " && " & ¬
            "mkdir -p " & quoted form of auDest & " && " & ¬
            "rm -rf " & quoted form of (vst3Dest & "/RTM Send.vst3") & " && " & ¬
            "rm -rf " & quoted form of (auDest & "/RTM Send.component") & " && " & ¬
            "cp -R " & quoted form of vst3Source & " " & quoted form of vst3Dest & "/ && " & ¬
            "cp -R " & quoted form of auSource & " " & quoted form of auDest & "/" ¬
            with administrator privileges
        
        do shell script "xattr -cr /Library/Audio/Plug-Ins/VST3/RTM\\ Send.vst3 && " & ¬
            "xattr -cr /Library/Audio/Plug-Ins/Components/RTM\\ Send.component" ¬
            with administrator privileges
    end if
    
    display dialog "RTM Send installed successfully!

The plugin will appear in your DAW after a rescan.
In Wavelab: Plug-ins → Plug-in Manager → Rescan" ¬
        buttons {"Done"} default button "Done" ¬
        with icon note ¬
        with title "RTM Send Installed"
end run
